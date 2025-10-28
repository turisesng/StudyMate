
import React, { useState, useEffect, useRef, useCallback } from 'react';
// Fix: Imported `GoogleGenAI` and `Type` from the official `@google/genai` package to align with best practices.
import { GoogleGenAI, Type } from '@google/genai';

// Declare global variables from index.html to satisfy TypeScript
declare global {
    interface Window {
        __firebase_config: any;
        __initial_auth_token: string;
        __app_id: string;
        firebase: any;
        google: any;
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
    namespace NodeJS {
      interface ProcessEnv {
        readonly API_KEY: string;
      }
    }
}

// --- TYPE DEFINITIONS ---
interface Flashcard {
    term: string;
    definition: string;
}

interface Lecture {
    id: string;
    title: string;
    summary: string;
    flashcards: Flashcard[];
    timestamp: any; // Firestore timestamp type
    originalText: string;
}

type Tab = 'input' | 'notes' | 'flashcards' | 'history';

// --- MOCK DATA for fallback mode ---
const MOCK_LECTURES: Lecture[] = [
    {
        id: 'mock-1',
        title: 'Introduction to AI (Sample)',
        summary: 'This is a sample summary about Artificial Intelligence. It explains the core concepts, including machine learning, deep learning, and natural language processing. The goal is to provide a foundational understanding of the field.',
        flashcards: [
            { term: 'Machine Learning', definition: 'A field of study in artificial intelligence concerned with the development and study of statistical algorithms that can learn from data and generalize to unseen data.' },
            { term: 'Neural Network', definition: 'A series of algorithms that endeavors to recognize underlying relationships in a set of data through a process that mimics the way the human brain operates.' },
        ],
        timestamp: { toDate: () => new Date(Date.now() - 1000 * 60 * 5) }, // 5 mins ago
        originalText: 'This is the original text for the sample lecture on AI.',
    }
];

// --- SVG ICONS ---
const IconMicrophone: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm6.5 9a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1a.5.5 0 0 1 .5.5ZM12 14a5 5 0 0 0-5 5v1a1 1 0 0 0 2 0v-1a3 3 0 0 1 6 0v1a1 1 0 0 0 2 0v-1a5 5 0 0 0-5-5Z" />
    </svg>
);

const IconStop: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M5 5h14v14H5V5Z" />
    </svg>
);

const IconSparkles: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path fillRule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.846.813l2.846-.813a.75.75 0 0 1 .976.976l-.813 2.846a3.75 3.75 0 0 0 0 5.692l.813 2.846a.75.75 0 0 1-.976.976l-2.846-.813a3.75 3.75 0 0 0-2.846.813l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.846-.813l-2.846.813a.75.75 0 0 1-.976-.976l.813-2.846a3.75 3.75 0 0 0 0-5.692l-.813-2.846a.75.75 0 0 1 .976-.976l2.846.813a3.75 3.75 0 0 0 2.846-.813l.813-2.846A.75.75 0 0 1 9 4.5ZM13.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" clipRule="evenodd" />
    </svg>
);

const IconLoading: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

// --- APP COMPONENT ---
export default function App() {
    // --- STATE MANAGEMENT ---
    const [lectureText, setLectureText] = useState<string>('');
    const [isRecording, setIsRecording] = useState<boolean>(false);
    const [interimTranscript, setInterimTranscript] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<Tab>('input');
    const [lectures, setLectures] = useState<Lecture[]>([]);
    const [selectedLecture, setSelectedLecture] = useState<Lecture | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [mockMode, setMockMode] = useState<boolean>(false);
    
    const recognitionRef = useRef<any>(null);

    // --- FIREBASE & AUTH EFFECT ---
    useEffect(() => {
        const appId = window.__app_id || 'MOCK_APP_ID';
        let unsubscribe = () => {};

        const setupMockMode = () => {
            console.log("Firebase config not found. Running in local mock mode.");
            setMockMode(true);
            setUserId('MOCK_USER_ID');
            setLectures(MOCK_LECTURES);
            setSelectedLecture(MOCK_LECTURES.length > 0 ? MOCK_LECTURES[0] : null);
        };

        const setupFirebase = async () => {
            // Fix: Gracefully handle missing Firebase config by checking for it first,
            // preventing the "setup failed" error and seamlessly falling back to mock mode.
            if (!window.firebase || !window.__firebase_config || !window.__firebase_config.apiKey) {
                setupMockMode();
                return;
            }

            try {
                if (!window.firebase.apps.length) {
                    window.firebase.initializeApp(window.__firebase_config);
                }
                const auth = window.firebase.auth();
                const firestore = window.firebase.firestore();

                if (window.__initial_auth_token) {
                    await auth.signInWithCustomToken(window.__initial_auth_token);
                } else {
                    await auth.signInAnonymously();
                }

                const currentUser = auth.currentUser;
                if (!currentUser) throw new Error("Authentication failed.");
                setUserId(currentUser.uid);
                setMockMode(false);

                const collectionPath = `/artifacts/${appId}/users/${currentUser.uid}/lectures`;
                const lecturesCollection = firestore.collection(collectionPath);
                
                unsubscribe = lecturesCollection.orderBy('timestamp', 'desc').onSnapshot(snapshot => {
                    const lecturesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Lecture[];
                    setLectures(lecturesData);
                    
                    setSelectedLecture(currentSelected => {
                        if (currentSelected && lecturesData.some(l => l.id === currentSelected.id)) {
                           return currentSelected;
                        }
                        return lecturesData.length > 0 ? lecturesData[0] : null;
                    });
                }, err => {
                    console.error("Firestore connection error. Falling back to local mode.", err);
                    setupMockMode();
                });

            } catch (err: any) {
                console.error("An error occurred during Firebase setup. Falling back to local mode.", err.message);
                setupMockMode();
            }
        };

        setupFirebase();

        return () => {
            unsubscribe();
        };
    }, []);

    // --- SPEECH RECOGNITION EFFECT ---
    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
            let finalTranscript = '';
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interim += event.results[i][0].transcript;
                }
            }
            setLectureText(prev => prev + finalTranscript);
            setInterimTranscript(interim);
        };
        
        recognition.onend = () => {
            setIsRecording(false);
            setInterimTranscript('');
        };

        recognitionRef.current = recognition;

        return () => {
            recognitionRef.current?.stop();
        };
    }, []);

    const handleToggleRecording = useCallback(() => {
        if (isRecording) {
            recognitionRef.current?.stop();
            setIsRecording(false);
        } else {
            setLectureText('');
            setInterimTranscript('');
            recognitionRef.current?.start();
            setIsRecording(true);
        }
    }, [isRecording]);

    const handleGenerate = useCallback(async () => {
        if (!lectureText.trim() || !userId) {
            setError("Lecture text is required.");
            return;
        }
        setIsLoading(true);
        setError(null);
        setActiveTab('notes');

        try {
            // Fix: Updated Gemini API usage to follow best practices. This includes using the imported `GoogleGenAI`,
            // a stable model name ('gemini-2.5-flash'), and the correct structure for the `generateContent` call.
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const model = "gemini-2.5-flash";
            const systemInstruction = "You are an expert academic assistant. Your task is to process the provided lecture text and generate a concise summary and a set of flashcards with key terms and their definitions. Ensure the output is structured according to the provided JSON schema.";
            const contents = lectureText;
            const config = {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING },
                        flashcards: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    term: { type: Type.STRING },
                                    definition: { type: Type.STRING },
                                },
                                required: ["term", "definition"],
                            },
                        },
                    },
                    required: ["summary", "flashcards"],
                }
            };

            const response = await ai.models.generateContent({ model, contents, config });
            const jsonString = response.text.trim();
            const result = JSON.parse(jsonString);

            const lectureData = {
                title: lectureText.substring(0, 40) + '...',
                summary: result.summary,
                flashcards: result.flashcards,
                originalText: lectureText,
            };

            if (mockMode) {
                const newLecture: Lecture = {
                    id: `mock-${Date.now()}`,
                    ...lectureData,
                    timestamp: { toDate: () => new Date() },
                };
                setLectures(prev => [newLecture, ...prev]);
                setSelectedLecture(newLecture);
            } else {
                // Fix: Corrected the type for `newLecture`. `timestamp` is a valid property for the new lecture data
                // sent to Firestore. The type should only omit 'id', which is generated by Firestore.
                const newLecture: Omit<Lecture, 'id'> = {
                    ...lectureData,
                    timestamp: window.firebase.firestore.FieldValue.serverTimestamp(),
                };
                const appId = window.__app_id || 'MOCK_APP_ID';
                const collectionPath = `/artifacts/${appId}/users/${userId}/lectures`;
                await window.firebase.firestore().collection(collectionPath).add(newLecture);
            }
            
        } catch (err: any) {
            console.error("Generation failed:", err);
            setError(`An error occurred during generation: ${err.message || 'Unknown error'}`);
            setActiveTab('input');
        } finally {
            setIsLoading(false);
        }
    }, [lectureText, userId, mockMode]);

    const handleSelectLecture = (lecture: Lecture) => {
        setSelectedLecture(lecture);
        setActiveTab('notes');
    };

    const isGenerateDisabled = !lectureText.trim() || isLoading;

    return (
        <div className="min-h-screen bg-gray-100 font-sans text-gray-800">
            <div className="container mx-auto p-4 md:p-8 max-w-5xl">
                <header className="text-center mb-8">
                    <h1 className="text-4xl md:text-5xl font-bold text-indigo-800">StudyMate AI</h1>
                    <p className="text-lg text-indigo-600 mt-2">Transform lectures into powerful study materials instantly.</p>
                </header>

                <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-lg">
                    {/* Tabs */}
                    <div className="border-b border-gray-200 mb-6">
                        <nav className="-mb-px flex space-x-4 sm:space-x-8" aria-label="Tabs">
                            {(['input', 'notes', 'flashcards', 'history'] as Tab[]).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`${
                                        activeTab === tab
                                            ? 'border-indigo-500 text-indigo-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm capitalize transition-colors`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </nav>
                    </div>

                    {/* Tab Content */}
                    <div>
                        {activeTab === 'input' && (
                            <div className="space-y-4">
                                <textarea
                                    className="w-full h-64 p-4 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm"
                                    placeholder="Paste your lecture transcript here, or use the microphone to transcribe."
                                    value={lectureText}
                                    onChange={(e) => setLectureText(e.target.value)}
                                ></textarea>
                                {interimTranscript && <p className="text-sm text-gray-500 italic">"{interimTranscript}"</p>}
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <button
                                        onClick={handleToggleRecording}
                                        className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold text-white shadow-md transition-transform transform hover:scale-105 ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                                    >
                                        {isRecording ? <IconStop className="w-5 h-5" /> : <IconMicrophone className="w-5 h-5" />}
                                        {isRecording ? 'Stop Recording' : 'Start Recording'}
                                    </button>
                                    <button
                                        onClick={handleGenerate}
                                        disabled={isGenerateDisabled}
                                        className="flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold text-white shadow-md transition-transform transform hover:scale-105 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:scale-100"
                                    >
                                        {isLoading ? <IconLoading className="w-5 h-5" /> : <IconSparkles className="w-5 h-5" />}
                                        {isLoading ? 'Generating...' : 'Generate Materials'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'notes' && (
                            <div>
                                <h2 className="text-2xl font-bold mb-4 text-indigo-700">Smart Notes</h2>
                                {isLoading && !selectedLecture ? <p>Generating summary...</p> : selectedLecture ? (
                                    <div className="prose max-w-none p-4 bg-indigo-50 rounded-lg">
                                        <p>{selectedLecture.summary}</p>
                                    </div>
                                ) : <p className="text-gray-500">No lecture selected or generated yet.</p>}
                            </div>
                        )}

                        {activeTab === 'flashcards' && (
                            <div>
                                <h2 className="text-2xl font-bold mb-4 text-indigo-700">Flashcards</h2>
                                {isLoading && !selectedLecture ? <p>Generating flashcards...</p> : selectedLecture && selectedLecture.flashcards.length > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {selectedLecture.flashcards.map((card, index) => (
                                            <div key={index} className="bg-white border border-indigo-200 rounded-xl shadow-sm p-4 flex flex-col gap-2">
                                                <h3 className="font-bold text-indigo-800">{card.term}</h3>
                                                <p className="text-gray-600 text-sm">{card.definition}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : <p className="text-gray-500">No flashcards available for this lecture.</p>}
                            </div>
                        )}

                        {activeTab === 'history' && (
                             <div>
                                <h2 className="text-2xl font-bold mb-4 text-indigo-700">Lecture History</h2>
                                {mockMode && <div className="mb-4 p-3 bg-yellow-100 text-yellow-800 border-l-4 border-yellow-500 rounded-r-lg"><strong>Notice:</strong> Running in local mode. History will not be saved permanently.</div>}
                                {lectures.length > 0 ? (
                                    <ul className="space-y-3">
                                        {lectures.map((lecture) => (
                                            <li key={lecture.id}>
                                                <button onClick={() => handleSelectLecture(lecture)} className={`w-full text-left p-4 rounded-lg transition-colors ${selectedLecture?.id === lecture.id ? 'bg-indigo-100 ring-2 ring-indigo-400' : 'bg-gray-50 hover:bg-indigo-50'}`}>
                                                    <p className="font-semibold text-indigo-900">{lecture.title}</p>
                                                    <p className="text-sm text-gray-500">
                                                        {new Date(lecture.timestamp?.toDate()).toLocaleString()}
                                                    </p>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : <p className="text-gray-500">No past lectures found.</p>}
                            </div>
                        )}
                        
                        {error && (
                            <div className="mt-4 p-4 bg-red-100 text-red-700 border border-red-300 rounded-lg">
                                <p><span className="font-bold">Error:</span> {error}</p>
                            </div>
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
}
