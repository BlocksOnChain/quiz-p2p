'use client';

import { RTCService } from './rtc';
import { v4 as uuidv4 } from 'uuid';

// Question and answer interfaces
export interface Question {
  id: string;
  type: 'question';
  text: string;
  options?: string[];
  revealTime: number; // Timestamp when to reveal
}

export interface Answer {
  type: 'answer';
  questionId: string;
  answer: string;
  participantId: string;
}

// Message types for RTC communication
export type MessageType = 'question' | 'answer' | 'join' | 'ack' | 'ping';

export class RTCQuizService {
  private rtc: RTCService | null = null;
  private roomId: string = '';
  private participantId: string;
  private isHost: boolean = false;
  private questionTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // Callbacks
  private onQuestionCallback: ((question: Question) => void) | null = null;
  private onAnswerCallback: ((answer: Answer) => void) | null = null;
  private onParticipantJoinCallback: ((participantId: string) => void) | null = null;
  private onConnectionStatusCallback: ((status: string) => void) | null = null;
  private onParticipantCountCallback: ((count: number) => void) | null = null;
  
  constructor() {
    this.participantId = uuidv4();
  }
  
  // Initialize the quiz service
  async init(): Promise<void> {
    // Just initialize without connecting to any room
    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Ready to create or join a quiz');
    }
  }
  
  // Create a new quiz
  async createQuiz(name: string): Promise<string> {
    // Generate a room code
    this.roomId = uuidv4().substring(0, 8);
    this.isHost = true;
    
    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Creating quiz room...');
    }
    
    // Initialize RTC service
    this.rtc = new RTCService(this.roomId, true);
    this.setupRTCCallbacks();
    
    // Start the RTC service
    await this.rtc.start();
    
    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Quiz created successfully. Waiting for participants...');
    }
    
    return this.roomId;
  }
  
  // Join an existing quiz
  async joinQuiz(roomCode: string): Promise<void> {
    this.roomId = roomCode;
    this.isHost = false;
    
    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Joining quiz...');
    }
    
    // Initialize RTC service
    this.rtc = new RTCService(roomCode, false);
    this.setupRTCCallbacks();
    
    // Start the RTC service
    await this.rtc.start();
    
    // Send join message to host
    if (this.rtc) {
      await this.rtc.broadcast('join', {
        participantId: this.participantId
      });
    }
    
    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Joined quiz successfully');
    }
  }
  
  // Set up RTC callbacks
  private setupRTCCallbacks(): void {
    if (!this.rtc) return;
    
    this.rtc.onConnection((peerId) => {
      console.log(`Connected to peer: ${peerId}`);
    });
    
    this.rtc.onDisconnection((peerId) => {
      console.log(`Disconnected from peer: ${peerId}`);
    });
    
    this.rtc.onMessage((event) => {
      this.handleRTCMessage(event);
    });
    
    this.rtc.onError((error) => {
      console.error('RTC error:', error);
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback(`Connection error: ${error.message}`);
      }
    });
    
    this.rtc.onPeerCountChange((count) => {
      console.log(`Connected peers: ${count}`);
      if (this.onParticipantCountCallback) {
        this.onParticipantCountCallback(count);
      }
    });
  }
  
  // Handle RTC messages
  private handleRTCMessage(event: any): void {
    const { from, type, data } = event;
    
    switch (type) {
      case 'question':
        this.handleQuestionMessage(data as Question);
        break;
      case 'answer':
        this.handleAnswerMessage({
          ...data,
          type: 'answer'
        } as Answer);
        break;
      case 'join':
        this.handleJoinMessage(data.participantId);
        break;
      case 'ack':
        // Handle acknowledgment
        break;
      case 'ping':
        // Handle ping (heartbeat)
        break;
    }
  }
  
  // Handle a question message
  private handleQuestionMessage(question: Question): void {
    // Don't process outdated questions
    if (question.revealTime < Date.now() - 60000) {
      console.log('Ignoring outdated question:', question.id);
      return;
    }
    
    console.log('Received question:', question.text);
    
    // If we're a participant, we process the question
    if (!this.isHost) {
      // Clear any existing timer for the same question
      if (this.questionTimers.has(question.id)) {
        clearTimeout(this.questionTimers.get(question.id)!);
      }
      
      // Setup timer to reveal the question locally after revealTime
      const timeDiff = question.revealTime - Date.now();
      const timeout = Math.max(0, timeDiff);
      
      const timer = setTimeout(() => {
        if (this.onQuestionCallback) {
          this.onQuestionCallback(question);
        }
        this.questionTimers.delete(question.id);
      }, timeout);
      
      this.questionTimers.set(question.id, timer);
    }
  }
  
  // Handle an answer message
  private handleAnswerMessage(answer: Answer): void {
    // Don't process our own answers or answers if we're not the host
    if (answer.participantId === this.participantId || !this.isHost) return;
    
    console.log('Received answer from participant:', answer.participantId);
    
    if (this.onAnswerCallback) {
      this.onAnswerCallback(answer);
    }
  }
  
  // Handle a join message
  private handleJoinMessage(participantId: string): void {
    // Don't process our own join messages
    if (participantId === this.participantId) return;
    
    console.log('Participant joined:', participantId);
    
    if (this.onParticipantJoinCallback) {
      this.onParticipantJoinCallback(participantId);
    }
  }
  
  // Publish a question
  async publishQuestion(questionText: string, options?: string[]): Promise<string> {
    if (!this.rtc) {
      throw new Error('RTC service not initialized');
    }
    
    // Create the question
    const questionId = uuidv4();
    const question: Question = {
      id: questionId,
      type: 'question',
      text: questionText,
      options,
      revealTime: Date.now() + 5000 // 5 seconds from now
    };
    
    // Broadcast the question to all peers
    await this.rtc.broadcast('question', question);
    
    // Send it multiple times to ensure delivery
    const rtc = this.rtc; // Store reference to avoid null checks in setTimeout
    setTimeout(() => {
      if (rtc) {
        rtc.broadcast('question', question);
      }
    }, 500);
    
    setTimeout(() => {
      if (rtc) {
        rtc.broadcast('question', question);
      }
    }, 1500);
    
    console.log('Published question:', questionText);
    
    return questionId;
  }
  
  // Submit an answer
  async submitAnswer(questionId: string, answer: string): Promise<void> {
    if (!this.rtc) {
      throw new Error('RTC service not initialized');
    }
    
    const answerData = {
      questionId,
      answer,
      participantId: this.participantId
    };
    
    // Broadcast the answer
    await this.rtc.broadcast('answer', answerData);
    
    // Send it again to ensure delivery
    const rtc = this.rtc; // Store reference to avoid null checks in setTimeout
    setTimeout(() => {
      if (rtc) {
        rtc.broadcast('answer', answerData);
      }
    }, 500);
    
    console.log('Submitted answer:', answer);
  }
  
  // Get the number of connected participants
  getParticipantCount(): number {
    if (!this.rtc) return 0;
    return this.rtc.getConnectedPeerCount();
  }
  
  // Register callback for questions
  onQuestion(callback: (question: Question) => void): void {
    this.onQuestionCallback = callback;
  }
  
  // Register callback for answers
  onAnswer(callback: (answer: Answer) => void): void {
    this.onAnswerCallback = callback;
  }
  
  // Register callback for participant joins
  onParticipantJoin(callback: (participantId: string) => void): void {
    this.onParticipantJoinCallback = callback;
  }
  
  // Register callback for connection status updates
  onConnectionStatus(callback: (status: string) => void): void {
    this.onConnectionStatusCallback = callback;
  }
  
  // Register callback for participant count changes
  onParticipantCount(callback: (count: number) => void): void {
    this.onParticipantCountCallback = callback;
  }
  
  // Clean up resources
  async cleanup(): Promise<void> {
    // Clear all timers
    for (const timer of this.questionTimers.values()) {
      clearTimeout(timer);
    }
    this.questionTimers.clear();
    
    // Stop RTC service
    if (this.rtc) {
      this.rtc.stop();
      this.rtc = null;
    }
  }
}

// Singleton instance
let rtcQuizServiceInstance: RTCQuizService | null = null;

// Get or create the quiz service instance
export const getRTCQuizService = (): RTCQuizService => {
  if (!rtcQuizServiceInstance) {
    rtcQuizServiceInstance = new RTCQuizService();
  }
  return rtcQuizServiceInstance;
}; 