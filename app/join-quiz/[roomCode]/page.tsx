'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getQuizService, Question } from '../../services/quiz';

// A countdown component for the 5-second delay
const CountdownTimer = ({ seconds, onComplete }: { seconds: number, onComplete: () => void }) => {
  const [timeLeft, setTimeLeft] = useState(seconds);
  
  useEffect(() => {
    if (timeLeft <= 0) {
      onComplete();
      return;
    }
    
    const timer = setTimeout(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [timeLeft, onComplete]);
  
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <p className="text-lg mb-4">Next question in...</p>
      <div className="text-5xl font-bold text-blue-600">{timeLeft}</div>
    </div>
  );
};

export default function QuizRoom() {
  const params = useParams();
  const roomCode = params.roomCode as string;
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isJoining, setIsJoining] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string>('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>("Initializing P2P connection...");
  
  // Initialize the quiz service and join the room
  useEffect(() => {
    const initAndJoin = async () => {
      try {
        setConnectionStatus("Initializing P2P connection...");
        const quizService = getQuizService();

        // Set a timeout to check if we're taking too long to connect
        const connectionTimeout = setTimeout(() => {
          if (!isInitialized) {
            setConnectionStatus("Connection is taking longer than expected. This might be due to network restrictions. The quiz will still work, but may use relay servers instead of direct connections.");
          }
        }, 5000);
        
        await quizService.init();
        
        // Set up question handler
        quizService.onQuestion((question) => {
          setCurrentQuestion(question);
          setIsCountingDown(false);
          setSelectedAnswer('');
          setHasSubmitted(false);
        });
        
        // Join the quiz room
        setConnectionStatus("Joining quiz room...");
        await quizService.joinQuiz(roomCode);
        setIsJoining(false);
        setIsInitialized(true);
        setConnectionStatus("Successfully joined quiz room!");
        clearTimeout(connectionTimeout);
      } catch (error) {
        console.error('Failed to join quiz room:', error);
        setError('Failed to join the quiz. Please try again.');
        setConnectionStatus("Connection error. Please try again.");
      }
    };
    
    initAndJoin();
    
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
  }, [roomCode, isInitialized]);

  // Submit an answer
  const handleSubmitAnswer = async () => {
    if (!currentQuestion || !selectedAnswer.trim()) {
      return;
    }
    
    try {
      const quizService = getQuizService();
      await quizService.submitAnswer(currentQuestion.id, selectedAnswer);
      setHasSubmitted(true);
    } catch (error) {
      console.error('Failed to submit answer:', error);
      alert('Failed to submit answer. Please try again.');
    }
  };
  
  // Handle completion of countdown
  const handleCountdownComplete = () => {
    setIsCountingDown(false);
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="p-8 bg-white rounded-lg shadow-md">
          <h1 className="text-2xl font-bold mb-4 text-red-600">Error</h1>
          <p className="mb-4">{error}</p>
          <Link href="/join-quiz" className="text-blue-600 hover:text-blue-800">
            Back to Join Quiz
          </Link>
        </div>
      </div>
    );
  }

  if (!isInitialized || isJoining) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="p-8 max-w-md w-full bg-white rounded-lg shadow-md">
          <h1 className="text-2xl font-bold mb-4">Joining Quiz...</h1>
          <p className="mb-4">Please wait while we connect to the quiz room.</p>
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
  
  if (isCountingDown) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-full max-w-lg p-8 bg-white rounded-lg shadow-md">
          <h1 className="text-2xl font-bold mb-4 text-center">Get Ready!</h1>
          <CountdownTimer seconds={5} onComplete={handleCountdownComplete} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 bg-gray-100">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4">
          <h1 className="text-3xl font-bold mb-2">Quiz Room: {roomCode}</h1>
          <p className="text-gray-600">Waiting for questions from the host...</p>
        </div>
        
        {currentQuestion ? (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8 animate-fadeIn">
            <h2 className="text-xl font-semibold mb-4">{currentQuestion.text}</h2>
            
            {currentQuestion.options && currentQuestion.options.length > 0 ? (
              <div className="space-y-3 mb-6">
                {currentQuestion.options.map((option, index) => (
                  <div key={index} className="flex items-center">
                    <input
                      type="radio"
                      id={`option-${index}`}
                      name="answer"
                      value={option}
                      checked={selectedAnswer === option}
                      onChange={() => setSelectedAnswer(option)}
                      disabled={hasSubmitted}
                      className="mr-3"
                    />
                    <label htmlFor={`option-${index}`} className="text-lg">
                      {option}
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mb-6">
                <label htmlFor="answer" className="block text-sm font-medium text-gray-700 mb-1">
                  Your Answer
                </label>
                <input
                  type="text"
                  id="answer"
                  value={selectedAnswer}
                  onChange={(e) => setSelectedAnswer(e.target.value)}
                  disabled={hasSubmitted}
                  className="w-full p-2 border border-gray-300 rounded-md"
                  placeholder="Type your answer here"
                />
              </div>
            )}
            
            {hasSubmitted ? (
              <div className="p-4 bg-green-50 text-green-800 rounded-md">
                Your answer has been submitted!
              </div>
            ) : (
              <button
                onClick={handleSubmitAnswer}
                disabled={!selectedAnswer.trim()}
                className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300"
              >
                Submit Answer
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <p className="text-lg text-gray-700">
              Waiting for the first question...
            </p>
          </div>
        )}
      </div>
    </div>
  );
} 