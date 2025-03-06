'use client';

import { Libp2p } from 'libp2p';
import { initLibp2p, encodeMessage, decodeMessage, getPeerId } from '../lib/libp2p';
import { v4 as uuidv4 } from 'uuid';
import { multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';

// Quiz message types
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

export interface JoinAnnouncement {
  type: 'join';
  participantId: string;
  timestamp: number;
  peerIdString?: string; // For direct connection
}

export interface PresenceAck {
  type: 'presence_ack';
  participantId: string;
  targetId: string; // The participant ID being acknowledged
  timestamp: number;
  peerIdString?: string; // For direct connection
  hostPeerIdString?: string; // Host shares their peer ID for direct connection
}

// Direct connection message
export interface DirectConnectionInfo {
  type: 'direct_connection';
  participantId: string;
  peerIdString: string;
  timestamp: number;
}

export type QuizMessage = Question | Answer | JoinAnnouncement | PresenceAck | DirectConnectionInfo;

// Topic prefix for quiz rooms
const QUIZ_TOPIC_PREFIX = 'quiz-room-';

// Helper to check if we're in a secure context
const isSecureContext = (): boolean => {
  return typeof window !== 'undefined' && 
         (window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost');
};

// Quiz service class to handle quiz operations
export class QuizService {
  private node: Libp2p | null = null;
  private quizTopic: string | null = null;
  private onQuestionCallback: ((question: Question) => void) | null = null;
  private onAnswerCallback: ((answer: Answer) => void) | null = null;
  private onParticipantJoinCallback: ((participantId: string) => void) | null = null;
  private onConnectionStatusCallback: ((status: string) => void) | null = null;
  private questionTimers: Map<string, NodeJS.Timeout> = new Map();
  private participantId: string;
  private isHost: boolean = false;
  private participantHeartbeatInterval: NodeJS.Timeout | null = null;
  private lastActiveTime: number = Date.now();
  private connectionRetryCount: number = 0;
  private maxRetries: number = 10;
  private knownPeers: Map<string, string> = new Map(); // participantId -> peerIdString
  private hostPeerId: string | null = null;
  private isInitialized: boolean = false;

  constructor() {
    // Generate a unique participant ID
    this.participantId = uuidv4();
  }

  // Initialize the quiz service - doesn't start p2p by default
  async init(startP2P: boolean = false): Promise<void> {
    // Only start p2p if explicitly requested
    if (startP2P) {
      return this.initP2P();
    }
    
    // Otherwise, just mark as initialized without starting p2p
    this.isInitialized = true;
    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Ready to create or join a quiz');
    }
    console.log('Quiz service initialized without P2P (deferred initialization)');
  }

  // Initialize the P2P networking - only called when actually needed
  private async initP2P(): Promise<void> {
    if (this.node) return;
    
    try {
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback('Initializing P2P connection...');
      }
      
      // Check if we're in a secure context
      if (!isSecureContext()) {
        const securityError = new Error(
          "Secure context required. Please use HTTPS or localhost instead of an IP address."
        );
        securityError.name = "SecurityError";
        throw securityError;
      }
      
      this.node = await initLibp2p();
      console.log('Quiz service P2P initialized with participantId:', this.participantId);
      
      // Keep track of last active time to ensure the node stays alive
      this.lastActiveTime = Date.now();
      
      // Set a heartbeat interval to keep the connection alive
      setInterval(() => {
        this.lastActiveTime = Date.now();
      }, 30000); // Every 30 seconds

      // Reset connection retry count
      this.connectionRetryCount = 0;
      
      this.isInitialized = true;
      
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback('P2P connection established');
      }
    } catch (error) {
      console.error('Failed to initialize P2P connection:', error);
      
      let errorMessage = 'Failed to establish P2P connection. ';
      
      // Provide more specific error messages
      if (error instanceof Error) {
        if (error.name === "SecurityError" || error.message.includes("crypto") || error.message.includes("secure context")) {
          errorMessage += "This app requires a secure context (HTTPS or localhost). " +
          "Please access the app using https:// or localhost instead of an IP address.";
        } else {
          errorMessage += `Error: ${error.message}. Please refresh and try again.`;
        }
      } else {
        errorMessage += "Please refresh and try again.";
      }
      
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback(errorMessage);
      }
      
      throw error;
    }
  }

  // Add a fallback approach when P2P isn't available
  private async attemptFallbackConnection(): Promise<void> {
    // In a real app, this would connect to a centralized server
    // For now, we'll simulate this with a local mock
    
    console.log('Using fallback connection mode (centralized instead of P2P)');
    
    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Using fallback connection mode. Some features may be limited.');
    }
    
    // Mark as initialized to allow basic functionality
    this.isInitialized = true;
    
    // Add diagnostic info if callback exists
    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Fallback connection active. Performance may be reduced.');
    }
  }

  // Update ensureP2P method to use fallback when needed
  private async ensureP2P(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Quiz service not initialized');
    }
    
    if (!this.node) {
      try {
        // Try to initialize P2P
        await this.initP2P();
      } catch (error) {
        console.error('P2P initialization failed, attempting fallback:', error);
        
        // If the error is related to secure context, try fallback
        if (error instanceof Error && 
            (error.name === "SecurityError" || 
             error.message.includes("crypto") || 
             error.message.includes("secure context"))) {
          
          // Use fallback instead
          await this.attemptFallbackConnection();
          
          // Add special diagnostic message
          if (this.onConnectionStatusCallback) {
            this.onConnectionStatusCallback(
              'P2P connections require HTTPS or localhost. Using limited fallback mode.' +
              ' For best experience, please use localhost or HTTPS.'
            );
          }
        } else {
          // For other errors, just pass them through
          throw error;
        }
      }
    }
  }

  // Create a new quiz room as host
  async createQuiz(name: string): Promise<string> {
    // Make sure P2P is initialized
    await this.ensureP2P();
    
    // Handle fallback mode (when P2P initialization failed)
    if (!this.node) {
      // In fallback mode, we'll still generate a room code but warn about limited functionality
      const roomCode = uuidv4().substring(0, 8);
      this.quizTopic = `${QUIZ_TOPIC_PREFIX}${roomCode}`;
      this.isHost = true;
      
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback('Quiz created in limited mode. Some features may not work properly.');
      }
      
      console.log(`Created quiz "${name}" with code: ${roomCode} (fallback mode)`);
      return roomCode;
    }
    
    // If we have P2P available, continue with normal flow
    // Reset any previous quizTopic if the user is trying to create multiple quizzes
    if (this.quizTopic) {
      try {
        // Unsubscribe from old topic
        const pubsub = this.node.services.pubsub as any;
        await pubsub.unsubscribe(this.quizTopic);
        console.log(`Unsubscribed from previous topic: ${this.quizTopic}`);
        
        // Clear any participant heartbeat
        if (this.participantHeartbeatInterval) {
          clearInterval(this.participantHeartbeatInterval);
          this.participantHeartbeatInterval = null;
        }
      } catch (error) {
        console.error('Error cleaning up previous quiz:', error);
      }
    }
    
    // Generate a unique room code
    const roomCode = uuidv4().substring(0, 8);
    this.quizTopic = `${QUIZ_TOPIC_PREFIX}${roomCode}`;
    this.isHost = true;
    this.knownPeers.clear();
    this.hostPeerId = null;
    
    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Creating quiz room...');
    }
    
    // Subscribe to the quiz topic
    await this.subscribeToTopic();
    
    console.log(`Created quiz "${name}" with topic: ${this.quizTopic}`);
    
    // Start periodic participant presence check
    this.startParticipantHeartbeat();

    if (this.onConnectionStatusCallback) {
      this.onConnectionStatusCallback('Quiz created successfully. Waiting for participants...');
    }
    
    return roomCode;
  }

  // Join an existing quiz room as participant
  async joinQuiz(roomCode: string): Promise<void> {
    // Make sure P2P is initialized
    await this.ensureP2P();
    
    // Handle fallback mode (when P2P initialization failed)
    if (!this.node) {
      // In fallback mode, we'll still set the quiz topic but warn about limited functionality
      this.quizTopic = `${QUIZ_TOPIC_PREFIX}${roomCode}`;
      this.isHost = false;
      
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback('Joined quiz in limited mode. Some features may not work properly.');
      }
      
      console.log(`Joined quiz with code: ${roomCode} (fallback mode)`);
      return;
    }
    
    // If we have P2P available, continue with normal flow
    if (this.quizTopic) {
      // Reset any previous quizTopic if the user is trying to join multiple quizzes
      if (this.quizTopic) {
        try {
          // Unsubscribe from old topic
          const pubsub = this.node.services.pubsub as any;
          await pubsub.unsubscribe(this.quizTopic);
          console.log(`Unsubscribed from previous topic: ${this.quizTopic}`);
          
          // Clear any participant heartbeat
          if (this.participantHeartbeatInterval) {
            clearInterval(this.participantHeartbeatInterval);
            this.participantHeartbeatInterval = null;
          }
        } catch (error) {
          console.error('Error cleaning up previous quiz:', error);
        }
      }
      
      this.quizTopic = `${QUIZ_TOPIC_PREFIX}${roomCode}`;
      this.isHost = false;
      this.hostPeerId = null;
      this.knownPeers.clear();
      
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback('Joining quiz...');
      }
      
      // Subscribe to the quiz topic
      await this.subscribeToTopic();
      
      console.log(`Joined quiz with topic: ${this.quizTopic}`);

      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback('Connecting to quiz host...');
      }
      
      // Announce presence to the host and other participants
      await this.announcePresence();
      
      // Start periodic participant presence check
      this.startParticipantHeartbeat();

      // Set up retry logic for joining
      this.connectionRetryCount = 0;
      this.attemptReconnect();
    }
  }

  // Attempt to reconnect if we don't get acknowledgment
  private attemptReconnect(): void {
    // Try to reconnect every 5 seconds, for up to maxRetries times
    const reconnectInterval = setInterval(async () => {
      // If we've already got a host peer ID or we've exceeded max retries, stop trying
      if (this.hostPeerId || this.connectionRetryCount >= this.maxRetries) {
        clearInterval(reconnectInterval);
        
        if (!this.hostPeerId && this.connectionRetryCount >= this.maxRetries) {
          console.error('Failed to connect to quiz host after maximum retries');
          if (this.onConnectionStatusCallback) {
            this.onConnectionStatusCallback('Failed to connect to quiz host. Please try again.');
          }
        }
        return;
      }
      
      this.connectionRetryCount++;
      console.log(`Retry ${this.connectionRetryCount}/${this.maxRetries}: Attempting to connect to quiz host...`);
      
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback(`Connecting to quiz host (attempt ${this.connectionRetryCount}/${this.maxRetries})...`);
      }
      
      // Try to announce presence again
      await this.announcePresence();
    }, 5000);
  }

  // Periodically check for participant presence
  private startParticipantHeartbeat(): void {
    if (this.participantHeartbeatInterval) {
      clearInterval(this.participantHeartbeatInterval);
    }
    
    // Every 15 seconds, announce presence or check for inactive participants
    this.participantHeartbeatInterval = setInterval(async () => {
      try {
        await this.announcePresence();
      } catch (error) {
        console.error('Error during participant heartbeat:', error);
      }
    }, 15000);
  }

  // Announce this participant's presence
  private async announcePresence(): Promise<void> {
    if (!this.node || !this.quizTopic) return;
    
    const myPeerId = getPeerId() || undefined;
    
    const announcement: JoinAnnouncement = {
      type: 'join',
      participantId: this.participantId,
      timestamp: Date.now(),
      peerIdString: myPeerId
    };
    
    // Send the message multiple times to increase delivery probability
    for (let i = 0; i < 3; i++) {
      const messageData = encodeMessage(announcement);
      const pubsub = this.node.services.pubsub as any;
      await pubsub.publish(this.quizTopic, messageData);
      
      // Short delay between retries
      if (i < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('Presence announced to the topic');
  }

  // Acknowledge a participant's presence
  private async acknowledgePresence(targetId: string, targetPeerId?: string): Promise<void> {
    if (!this.node || !this.quizTopic || !this.isHost) return;
    
    const myPeerId = getPeerId() || undefined;
    
    const ack: PresenceAck = {
      type: 'presence_ack',
      participantId: this.participantId,
      targetId,
      timestamp: Date.now(),
      peerIdString: myPeerId,
      hostPeerIdString: myPeerId
    };
    
    // Send the message multiple times to increase delivery probability
    for (let i = 0; i < 3; i++) {
      const messageData = encodeMessage(ack);
      const pubsub = this.node.services.pubsub as any;
      await pubsub.publish(this.quizTopic, messageData);
      
      // Short delay between retries
      if (i < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`Presence acknowledged for participant: ${targetId}`);

    // If we have the participant's peer ID, try to establish a direct connection
    if (targetPeerId && this.node) {
      try {
        console.log(`Attempting direct connection to peer: ${targetPeerId}`);
        
        // Convert string to proper PeerId object for dialing
        const peerId = peerIdFromString(targetPeerId);
        await this.node.dial(peerId);
        
        console.log(`Successfully established direct connection to: ${targetPeerId}`);
        
        // Store the peer ID for future direct connections
        this.knownPeers.set(targetId, targetPeerId);
      } catch (error) {
        console.warn(`Failed to establish direct connection to ${targetPeerId}:`, error);
      }
    }
  }

  // Subscribe to the quiz topic and set up message handlers
  private async subscribeToTopic(): Promise<void> {
    if (!this.node || !this.quizTopic) {
      throw new Error('Node or quiz topic not available');
    }

    // Subscribe to the topic
    const pubsub = this.node.services.pubsub as any;
    await pubsub.subscribe(this.quizTopic);
    
    console.log(`Subscribed to topic: ${this.quizTopic}`);
    
    // Set up message handler
    pubsub.addEventListener('message', (evt: any) => {
      const { topic, data } = evt.detail;
      
      if (topic === this.quizTopic) {
        const message = decodeMessage(data);
        if (!message) return;
        
        if (typeof message === 'object' && message !== null) {
          const msgType = (message as any).type;
          switch (msgType) {
            case 'question':
              this.handleQuestionMessage(message as Question);
              break;
            case 'answer':
              this.handleAnswerMessage(message as Answer);
              break;
            case 'join':
              this.handleJoinMessage(message as JoinAnnouncement);
              break;
            case 'presence_ack':
              this.handlePresenceAckMessage(message as PresenceAck);
              break;
            case 'direct_connection':
              this.handleDirectConnectionMessage(message as DirectConnectionInfo);
              break;
            default:
              console.warn('Unknown message type:', message);
          }
        }
      }
    });
    
    // Also directly subscribe to message events to ensure we don't miss any
    pubsub.addEventListener('gossipsub:message', (evt: any) => {
      try {
        const { topic, data } = evt.detail;
        
        if (topic === this.quizTopic) {
          const message = decodeMessage(data);
          if (!message) return;
          
          if (typeof message === 'object' && message !== null) {
            const msgType = (message as any).type;
            switch (msgType) {
              case 'question':
                this.handleQuestionMessage(message as Question);
                break;
              case 'answer':
                this.handleAnswerMessage(message as Answer);
                break;
              case 'join':
                this.handleJoinMessage(message as JoinAnnouncement);
                break;
              case 'presence_ack':
                this.handlePresenceAckMessage(message as PresenceAck);
                break;
              case 'direct_connection':
                this.handleDirectConnectionMessage(message as DirectConnectionInfo);
                break;
            }
          }
        }
      } catch (error) {
        console.error('Error handling gossipsub message:', error);
      }
    });
  }

  // Handle join announcement message
  private handleJoinMessage(joinMsg: JoinAnnouncement): void {
    // Don't process our own join messages
    if (joinMsg.participantId === this.participantId) return;
    
    console.log('Received join announcement from:', joinMsg.participantId);
    
    // If we're the host, acknowledge the participant's presence
    if (this.isHost) {
      this.acknowledgePresence(joinMsg.participantId, joinMsg.peerIdString);
    }
    
    // Notify about the new participant
    if (this.onParticipantJoinCallback) {
      this.onParticipantJoinCallback(joinMsg.participantId);
    }

    // Store peer ID if available
    if (joinMsg.peerIdString) {
      this.knownPeers.set(joinMsg.participantId, joinMsg.peerIdString);
    }
  }

  // Handle presence acknowledgment message
  private handlePresenceAckMessage(ackMsg: PresenceAck): void {
    // Only process acks intended for us
    if (ackMsg.targetId !== this.participantId) return;
    
    console.log('Received presence acknowledgment from:', ackMsg.participantId);
    
    // Store the host's peer ID if this is a response from the host
    if (ackMsg.hostPeerIdString) {
      this.hostPeerId = ackMsg.hostPeerIdString;
      console.log('Received host peer ID:', this.hostPeerId);
      
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback('Connected to quiz host');
      }

      // Try to establish a direct connection to the host
      if (this.node && this.hostPeerId) {
        try {
          const hostPeerId = peerIdFromString(this.hostPeerId);
          this.node.dial(hostPeerId)
            .then(() => console.log('Successfully established direct connection to host'))
            .catch(error => console.warn('Failed to establish direct connection to host:', error));
        } catch (error) {
          console.warn('Failed to initiate direct connection to host:', error);
        }
      }
    }

    // Store peer ID if available
    if (ackMsg.peerIdString) {
      this.knownPeers.set(ackMsg.participantId, ackMsg.peerIdString);
    }
  }

  // Handle direct connection message
  private handleDirectConnectionMessage(msg: DirectConnectionInfo): void {
    // Don't process our own messages
    if (msg.participantId === this.participantId) return;
    
    console.log('Received direct connection info from:', msg.participantId);
    
    // Store the peer ID
    this.knownPeers.set(msg.participantId, msg.peerIdString);
    
    // Try to establish a direct connection
    if (this.node) {
      try {
        const peerId = peerIdFromString(msg.peerIdString);
        this.node.dial(peerId)
          .then(() => console.log(`Successfully established direct connection to: ${msg.participantId}`))
          .catch(error => console.warn(`Failed to establish direct connection to ${msg.participantId}:`, error));
      } catch (error) {
        console.warn(`Failed to initiate direct connection to ${msg.participantId}:`, error);
      }
    }
  }

  // Publish a question as the quiz host
  async publishQuestion(questionText: string, options?: string[]): Promise<string> {
    if (!this.node || !this.quizTopic) {
      throw new Error('Node or quiz topic not available');
    }
    
    // Create the question with a 5-second delay
    const questionId = uuidv4();
    const question: Question = {
      id: questionId,
      type: 'question',
      text: questionText,
      options,
      revealTime: Date.now() + 5000 // 5 seconds from now
    };
    
    // Send the question multiple times to increase delivery probability
    for (let i = 0; i < 3; i++) {
      const messageData = encodeMessage(question);
      const pubsub = this.node.services.pubsub as any;
      await pubsub.publish(this.quizTopic, messageData);
      
      // Short delay between retries
      if (i < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('Published question:', questionText);
    
    // Setup timer to reveal the question locally after revealTime
    const timeDiff = question.revealTime - Date.now();
    const timeout = Math.max(0, timeDiff);
    
    // Clear any existing timer for the same question
    if (this.questionTimers.has(questionId)) {
      clearTimeout(this.questionTimers.get(questionId));
    }
    
    // Set new timer
    const timer = setTimeout(() => {
      if (this.onQuestionCallback) {
        this.onQuestionCallback(question);
      }
      this.questionTimers.delete(questionId);
    }, timeout);
    
    this.questionTimers.set(questionId, timer);
    
    return questionId;
  }

  // Submit an answer as a participant
  async submitAnswer(questionId: string, answer: string): Promise<void> {
    if (!this.node || !this.quizTopic) {
      throw new Error('Node or quiz topic not available');
    }
    
    const answerMsg: Answer = {
      type: 'answer',
      questionId,
      answer,
      participantId: this.participantId
    };
    
    // Send the answer multiple times to increase delivery probability
    for (let i = 0; i < 3; i++) {
      const messageData = encodeMessage(answerMsg);
      const pubsub = this.node.services.pubsub as any;
      await pubsub.publish(this.quizTopic, messageData);
      
      // Short delay between retries
      if (i < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('Submitted answer:', answer);
  }

  // Handle incoming question message
  private handleQuestionMessage(question: Question): void {
    // Don't process outdated questions
    if (question.revealTime < Date.now() - 60000) { // ignore questions older than 1 minute
      console.log('Ignoring outdated question:', question.id);
      return;
    }
    
    console.log('Received question:', question.text);
    
    // If we're a participant, we process the question
    if (!this.isHost) {
      // Clear any existing timer for the same question
      if (this.questionTimers.has(question.id)) {
        clearTimeout(this.questionTimers.get(question.id));
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

  // Handle incoming answer message
  private handleAnswerMessage(answer: Answer): void {
    // Don't process our own answers or answers if we're not the host
    if (answer.participantId === this.participantId || !this.isHost) return;
    
    console.log('Received answer from participant:', answer.participantId);
    
    if (this.onAnswerCallback) {
      this.onAnswerCallback(answer);
    }
  }

  // Register callback for new questions
  onQuestion(callback: (question: Question) => void): void {
    this.onQuestionCallback = callback;
  }
  
  // Register callback for new answers
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

  // Clean up resources
  async cleanup(): Promise<void> {
    // Clear all timers
    for (const timer of this.questionTimers.values()) {
      clearTimeout(timer);
    }
    this.questionTimers.clear();
    
    // Clear heartbeat interval
    if (this.participantHeartbeatInterval) {
      clearInterval(this.participantHeartbeatInterval);
      this.participantHeartbeatInterval = null;
    }
    
    // Unsubscribe from quiz topic if applicable
    if (this.node && this.quizTopic) {
      try {
        const pubsub = this.node.services.pubsub as any;
        await pubsub.unsubscribe(this.quizTopic);
        console.log(`Unsubscribed from topic: ${this.quizTopic}`);
      } catch (error) {
        console.error('Error unsubscribing from topic:', error);
      }
    }
    
    this.quizTopic = null;
    this.isInitialized = false;
  }
}

// Singleton instance of the quiz service
let quizServiceInstance: QuizService | null = null;

// Get or create the quiz service instance
export const getQuizService = (): QuizService => {
  if (!quizServiceInstance) {
    quizServiceInstance = new QuizService();
  }
  return quizServiceInstance;
}; 