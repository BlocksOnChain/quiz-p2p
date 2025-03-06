'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getQuizService } from '../services/quiz';

export default function JoinQuiz() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
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

  // Initialize the quiz service - only initialize basic services, not P2P
  useEffect(() => {
    const initQuizService = async () => {
      try {
        setConnectionStatus("Initializing...");
        const quizService = getQuizService();
        
        // Register connection status callback
        quizService.onConnectionStatus((status) => {
          console.log("Connection status:", status);
          setConnectionStatus(status);
          
          // Add diagnostic info
          setDiagnosticInfo(prev => 
            `${prev}\n${new Date().toLocaleTimeString()}: ${status}`
          );
        });
        
        // Initialize WITHOUT starting P2P connections
        await quizService.init(false);
        setIsInitialized(true);
        setConnectionStatus("Ready to join a quiz. Enter a room code to connect.");
        
        // Add diagnostic info
        setDiagnosticInfo(prev => 
          `${prev}\n${new Date().toLocaleTimeString()}: Service initialized. P2P will be established when joining a quiz.`
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
          const quizService = getQuizService();
          await quizService.cleanup();
        } catch (error) {
          console.error('Error during cleanup:', error);
        }
      };
      
      cleanup();
    };
  }, []);

  // Join a quiz only when the user submits the form
  const handleJoinQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!roomCode.trim()) {
      alert('Please enter a quiz room code');
      return;
    }
    
    setIsJoining(true);
    setConnectionStatus(`Connecting to quiz room ${roomCode}... (Setting up P2P connection)`);
    
    // Add diagnostic info
    setDiagnosticInfo(prev => 
      `${prev}\n${new Date().toLocaleTimeString()}: Attempting to join quiz with room code ${roomCode}`
    );
    
    try {
      const quizService = getQuizService();
      await quizService.joinQuiz(roomCode);
      
      // Add successful join to diagnostics
      setDiagnosticInfo(prev => 
        `${prev}\n${new Date().toLocaleTimeString()}: Successfully joined quiz room ${roomCode}`
      );
      
      // Navigate to the quiz room page
      router.push(`/join-quiz/${roomCode}`);
    } catch (error) {
      console.error('Failed to join quiz:', error);
      
      // Add error to diagnostics
      setDiagnosticInfo(prev => 
        `${prev}\n${new Date().toLocaleTimeString()}: Failed to join quiz: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      
      setConnectionStatus("Failed to join quiz. Please check the room code and try again.");
      alert('Failed to join quiz. Please check the room code and try again.');
      setIsJoining(false);
    }
  };

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="p-8 bg-white rounded-lg shadow-md">
          <h1 className="text-2xl font-bold mb-4">Initializing...</h1>
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-md mb-6">
        <h1 className="text-3xl font-bold mb-6 text-center">Join a Quiz</h1>
        
        {!isSecureContext && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-md border border-red-200">
            <h3 className="font-semibold mb-1">Security Warning</h3>
            <p className="text-sm">
              P2P connections require a secure context (HTTPS or localhost).
              You're currently using an insecure connection which may prevent joining quizzes.
            </p>
            <p className="text-sm mt-2">
              Please access this app via <strong>https://</strong> or <strong>localhost</strong> instead of an IP address.
            </p>
          </div>
        )}
        
        <form onSubmit={handleJoinQuiz}>
          <div className="mb-4">
            <label htmlFor="roomCode" className="block text-sm font-medium text-gray-700 mb-1">
              Room Code
            </label>
            <input
              type="text"
              id="roomCode"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-md"
              placeholder="Enter the room code"
              required
            />
          </div>
          
          <button
            type="submit"
            disabled={isJoining}
            className="w-full py-3 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300 mb-4"
          >
            {isJoining ? 'Joining...' : 'Join Quiz'}
          </button>
          
          <p className="text-sm text-gray-600 my-2">{connectionStatus}</p>
        </form>
        
        <div className="text-center">
          <p className="text-gray-600 mb-4">Don't have a room code?</p>
          <Link href="/create-quiz" className="text-blue-600 hover:text-blue-800">
            Create your own quiz
          </Link>
        </div>
      </div>
      
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">Connection Diagnostics</h2>
        <div className="mb-4">
          <h3 className="font-medium text-gray-700 mb-2">Troubleshooting Tips:</h3>
          <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
            <li>Make sure you're using a modern browser (Chrome or Firefox work best)</li>
            <li>Firewalls or corporate networks may block P2P connections</li>
            <li>Double-check that you entered the correct room code</li>
            <li>Try connecting from a different network if possible</li>
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
    </div>
  );
} 