'use client';

import { useState, useEffect } from 'react';
import { getRTCQuizService, Answer } from '../services/rtc-quiz';

export default function CreateQuiz() {
  const [quizName, setQuizName] = useState('');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [isCreating, setIsCreating] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [connectionStatus, setConnectionStatus] = useState<string>("Initializing...");
  const [diagnosticInfo, setDiagnosticInfo] = useState<string>("");
  const [isSecureContext, setIsSecureContext] = useState<boolean>(true);

  // Check if we're in a secure context when component mounts
  useEffect(() => {
    const checkSecureContext = () => {
      const secure = typeof window !== 'undefined' && 
                    (window.isSecureContext || 
                     location.protocol === 'https:' || 
                     location.hostname === 'localhost');
      setIsSecureContext(secure);
      
      if (!secure) {
        setDiagnosticInfo(prev => 
          `${prev}\n${new Date().toLocaleTimeString()}: Not in a secure context. P2P requires HTTPS or localhost.`
        );
      }
    };
    
    checkSecureContext();
  }, []);

  // Initialize the RTCQuizService
  useEffect(() => {
    const initQuizService = async () => {
      try {
        setConnectionStatus("Initializing...");
        const quizService = getRTCQuizService();

        // Set up answer handler
        quizService.onAnswer((answer) => {
          console.log("Received answer from participant:", answer.participantId);
          setAnswers(prev => [...prev, answer]);
          setParticipants(prev => {
            const newSet = new Set(prev);
            newSet.add(answer.participantId);
            return newSet;
          });
          
          // Add diagnostic info
          setDiagnosticInfo(prev => 
            `${prev}\n${new Date().toLocaleTimeString()}: Received answer from participant ${answer.participantId.substring(0, 6)}...`
          );
        });
        
        // Set up participant join handler
        quizService.onParticipantJoin((participantId) => {
          console.log("Participant joined:", participantId);
          setParticipants(prev => {
            const newSet = new Set(prev);
            newSet.add(participantId);
            return newSet;
          });
          
          // Add diagnostic info
          setDiagnosticInfo(prev => 
            `${prev}\n${new Date().toLocaleTimeString()}: Participant ${participantId.substring(0, 6)}... joined`
          );
        });
        
        // Set up connection status handler
        quizService.onConnectionStatus((status) => {
          console.log("Connection status:", status);
          setConnectionStatus(status);
          
          // Add diagnostic info
          setDiagnosticInfo(prev => 
            `${prev}\n${new Date().toLocaleTimeString()}: ${status}`
          );
        });
        
        // Set up participant count handler (new feature)
        quizService.onParticipantCount((count) => {
          console.log("Participant count:", count);
          // This ensures we always have the most accurate participant count
          setParticipants(new Set(Array.from({ length: count }, (_, i) => `peer-${i}`)));
        });
        
        // Initialize WITHOUT starting P2P
        await quizService.init();
        setIsInitialized(true);
        setConnectionStatus("Ready to create a quiz. P2P connection will be established when needed.");
        
        // Add diagnostic info
        setDiagnosticInfo(prev => 
          `${prev}\n${new Date().toLocaleTimeString()}: Service initialized. P2P will be established when creating a quiz.`
        );
      } catch (error) {
        console.error('Failed to initialize quiz service:', error);
        setConnectionStatus("Failed to initialize. Please refresh and try again.");
        
        // Add diagnostic info
        setDiagnosticInfo(prev => 
          `${prev}\n${new Date().toLocaleTimeString()}: Initialization error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    };
    
    initQuizService();
    
    // Clean up
    return () => {
      const cleanup = async () => {
        try {
          const quizService = getRTCQuizService();
          await quizService.cleanup();
        } catch (error) {
          console.error('Error during cleanup:', error);
        }
      };
      
      cleanup();
    };
  }, []);

  // Create a new quiz
  const handleCreateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!quizName.trim()) {
      alert('Please enter a quiz name');
      return;
    }
    
    setIsCreating(true);
    setConnectionStatus("Creating quiz room...");
    
    // Add diagnostic info
    setDiagnosticInfo(prev => 
      `${prev}\n${new Date().toLocaleTimeString()}: Creating quiz: "${quizName}"`
    );
    
    try {
      const quizService = getRTCQuizService();
      const code = await quizService.createQuiz(quizName);
      setRoomCode(code);
      
      // Add diagnostic info
      setDiagnosticInfo(prev => 
        `${prev}\n${new Date().toLocaleTimeString()}: Quiz created with room code: ${code}`
      );
    } catch (error) {
      console.error('Failed to create quiz:', error);
      
      // Add diagnostic info
      setDiagnosticInfo(prev => 
        `${prev}\n${new Date().toLocaleTimeString()}: Failed to create quiz: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      
      setConnectionStatus("Failed to create quiz. Please try again.");
      alert('Failed to create quiz. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  // Publish a question
  const handlePublishQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!question.trim()) {
      alert('Please enter a question');
      return;
    }
    
    try {
      const quizService = getRTCQuizService();
      
      // Filter out empty options
      const validOptions = options.filter(opt => opt.trim() !== '');
      const finalOptions = validOptions.length > 0 ? validOptions : undefined;
      
      // Add diagnostic info
      setDiagnosticInfo(prev => 
        `${prev}\n${new Date().toLocaleTimeString()}: Publishing question: "${question.substring(0, 20)}..." to ${participants.size} participants`
      );
      
      await quizService.publishQuestion(question, finalOptions);
      
      // Clear the form
      setQuestion('');
      setOptions(['', '', '', '']);
      
      // Reset answers for the new question
      setAnswers([]);
    } catch (error) {
      console.error('Failed to publish question:', error);
      alert('Failed to publish question. Please try again.');
    }
  };

  // Update an option at the specified index
  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  // Add a new empty option
  const handleAddOption = () => {
    setOptions([...options, '']);
  };

  // Remove an option at the specified index
  const handleRemoveOption = (index: number) => {
    const newOptions = [...options];
    newOptions.splice(index, 1);
    setOptions(newOptions);
  };

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="p-8 max-w-md w-full bg-white rounded-lg shadow-md">
          <h1 className="text-2xl font-bold mb-4">Initializing Quiz...</h1>
          <p className="mb-4">Please wait while we set up the peer-to-peer connection.</p>
          <div className="mt-4">
            <p className="text-sm text-gray-600">{connectionStatus}</p>
            <div className="mt-4 w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 bg-gray-100">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">P2P Quiz Creator</h1>
        
        {!isSecureContext && (
          <div className="mb-8 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
            <h3 className="font-semibold text-lg mb-2">Security Warning</h3>
            <p className="mb-2">
              P2P connections require a secure context (HTTPS or localhost).
              You&apos;re currently using an insecure connection which may prevent creating or hosting quizzes.
            </p>
            <p>
              Please access this app via <strong>https://</strong> or <strong>localhost</strong> instead of an IP address.
            </p>
          </div>
        )}
        
        {!roomCode ? (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Create a New Quiz</h2>
            <form onSubmit={handleCreateQuiz}>
              <div className="mb-4">
                <label htmlFor="quizName" className="block text-sm font-medium text-gray-700 mb-1">
                  Quiz Name
                </label>
                <input
                  type="text"
                  id="quizName"
                  value={quizName}
                  onChange={(e) => setQuizName(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md"
                  placeholder="Enter a name for your quiz"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isCreating}
                className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300"
              >
                {isCreating ? 'Creating...' : 'Create Quiz'}
              </button>
            </form>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
              <h2 className="text-xl font-semibold mb-2">Quiz: {quizName}</h2>
              <div className="mb-4 p-4 bg-blue-50 rounded-md">
                <p className="text-sm text-gray-700 mb-2">Share this code with participants:</p>
                <div className="flex items-center justify-between">
                  <p className="text-2xl font-mono font-bold">{roomCode}</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(roomCode);
                      alert('Room code copied to clipboard!');
                    }}
                    className="py-1 px-3 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-700 flex justify-between items-center">
                <div>
                  <p className="font-semibold">Participants connected: <span className="text-blue-600">{participants.size}</span></p>
                  <p className="text-xs text-gray-500 mt-1">{connectionStatus}</p>
                </div>
                {participants.size === 0 && (
                  <div className="text-amber-600 text-xs max-w-xs">
                    No participants yet. Make sure they have the correct room code and can connect to the P2P network.
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
              <h2 className="text-xl font-semibold mb-4">Publish a Question</h2>
              <form onSubmit={handlePublishQuestion}>
                <div className="mb-4">
                  <label htmlFor="question" className="block text-sm font-medium text-gray-700 mb-1">
                    Question
                  </label>
                  <input
                    type="text"
                    id="question"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md"
                    placeholder="Enter your question"
                    required
                  />
                </div>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Options (optional)
                  </label>
                  {options.map((option, index) => (
                    <div key={index} className="flex mb-2">
                      <input
                        type="text"
                        value={option}
                        onChange={(e) => handleOptionChange(index, e.target.value)}
                        className="flex-1 p-2 border border-gray-300 rounded-md"
                        placeholder={`Option ${index + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveOption(index)}
                        className="ml-2 py-2 px-3 bg-red-500 text-white rounded-md hover:bg-red-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleAddOption}
                    className="py-1 px-3 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                  >
                    + Add Option
                  </button>
                </div>
                
                <button
                  type="submit"
                  className="w-full py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Publish Question
                </button>
              </form>
            </div>
            
            {answers.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-8">
                <h2 className="text-xl font-semibold mb-4">Answers</h2>
                <ul className="divide-y divide-gray-200">
                  {answers.map((answer, index) => (
                    <li key={index} className="py-3">
                      <p className="font-medium">Participant: {answer.participantId.substring(0, 6)}...</p>
                      <p>Answer: {answer.answer}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* Diagnostic Information Section */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Diagnostic Information</h2>
                <button 
                  onClick={() => setDiagnosticInfo("")}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              </div>
              
              <div className="bg-gray-100 p-3 rounded-md">
                <p className="text-sm mb-2">Connection Status: {connectionStatus}</p>
                <p className="text-sm mb-2">Active Participants: {participants.size}</p>
                <div className="text-xs font-mono whitespace-pre-wrap bg-gray-800 text-green-400 p-2 rounded max-h-40 overflow-y-auto">
                  {diagnosticInfo || "No diagnostic information available yet."}
                </div>
              </div>
              
              <div className="mt-4 text-sm">
                <h3 className="font-semibold mb-2">Troubleshooting Tips:</h3>
                <ul className="list-disc pl-5 text-xs space-y-1">
                  <li>If participants can&apos;t connect, make sure they&apos;re using a modern browser like Chrome or Firefox</li>
                  <li>Network firewalls might block P2P connections, try connecting from a different network</li>
                  <li>If questions aren&apos;t being received, try sending them again</li>
                  <li>The application uses fallback relay servers if direct connections fail</li>
                </ul>
              </div>
            </div>
            
            {roomCode && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-8">
                <h2 className="text-xl font-semibold mb-4">Connection Diagnostics</h2>
                <div className="mb-4">
                  <h3 className="font-medium text-gray-700 mb-2">Troubleshooting Tips:</h3>
                  <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
                    <li>Make sure participants are using a modern browser (Chrome or Firefox work best)</li>
                    <li>Firewalls or corporate networks may block P2P connections</li>
                    <li>If direct connections fail, the app will try to use relay servers which may be slower</li>
                    <li>Try having participants connect from a different network if possible</li>
                    <li>Check browser console for more detailed connection logs</li>
                  </ul>
                </div>
                
                <div>
                  <h3 className="font-medium text-gray-700 mb-2">Connection Log:</h3>
                  <pre className="p-3 bg-gray-100 rounded text-xs text-gray-800 overflow-auto max-h-60 whitespace-pre-wrap">
                    {diagnosticInfo || "No connection events yet."}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
} 