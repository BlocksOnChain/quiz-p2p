'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function Home() {
  const [isSecureContext, setIsSecureContext] = useState<boolean>(true);

  // Check if we're in a secure context when component mounts
  useEffect(() => {
    const checkSecureContext = () => {
      const secure = typeof window !== 'undefined' && 
                    (window.isSecureContext || 
                     location.protocol === 'https:' || 
                     location.hostname === 'localhost');
      setIsSecureContext(secure);
    };
    
    checkSecureContext();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gray-100">
      <div className="max-w-4xl w-full mx-auto text-center bg-white rounded-lg shadow-md p-8">
        <h1 className="text-4xl font-bold mb-4">P2P Quiz App</h1>
        <p className="text-xl text-gray-600 mb-8">
          A real-time, browser-based quiz application using libp2p for peer-to-peer networking.
        </p>
        
        {!isSecureContext && (
          <div className="mb-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h3 className="text-lg font-semibold text-yellow-800 mb-2">⚠️ Connection Notice</h3>
            <p className="text-yellow-700 mb-2">
              This app works best in a secure context (HTTPS or localhost).
              You're currently using an insecure connection, which may limit some P2P functionality.
            </p>
            <p className="text-sm text-yellow-600">
              For the best experience, please access via <strong>https://</strong> or <strong>localhost</strong> instead of an IP address.
            </p>
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <Link 
            href="/create-quiz" 
            className="flex flex-col items-center justify-center p-8 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">Create Quiz</h2>
            <p className="text-gray-600">
              Create a new quiz as a host and share it with participants.
            </p>
          </Link>
          
          <Link 
            href="/join-quiz" 
            className="flex flex-col items-center justify-center p-8 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
          >
            <div className="w-16 h-16 bg-green-600 text-white rounded-full flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">Join Quiz</h2>
            <p className="text-gray-600">
              Join an existing quiz using a room code.
            </p>
          </Link>
        </div>
        
        <div className="p-6 bg-gray-50 rounded-lg">
          <h2 className="text-xl font-semibold mb-3">How It Works</h2>
          <ul className="text-left list-disc pl-6 mb-4 space-y-2">
            <li>Quiz creators publish questions that participants receive in real-time</li>
            <li>All communication happens directly between browsers using libp2p (peer-to-peer)</li>
            <li>A 5-second delay synchronizes question display across all participants</li>
            <li>Join from anywhere with an internet connection - no central server required!</li>
          </ul>
          {!isSecureContext ? (
            <p className="text-sm text-red-600 mt-4 font-medium">
              Note: Full P2P functionality requires a secure connection (HTTPS or localhost).
              Some features will use fallback mode on your current connection.
            </p>
          ) : (
            <p className="text-sm text-gray-500">
              This application uses peer-to-peer networking, so all connections are encrypted end-to-end.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
