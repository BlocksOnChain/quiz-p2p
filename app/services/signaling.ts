'use client';

// Signaling service to coordinate WebRTC connections

interface Peer {
  peerId: string;
  isHost: boolean;
}

interface PollResponse {
  success: boolean;
  offers: {
    from: string;
    offer: RTCSessionDescriptionInit;
    timestamp: number;
  }[];
  answers: {
    from: string;
    answer: RTCSessionDescriptionInit;
    timestamp: number;
  }[];
  newPeers: Peer[];
  timestamp: number;
}

export class SignalingService {
  private roomId: string;
  private peerId: string;
  private isHost: boolean;
  private lastPollTimestamp: number = 0;
  private pollingInterval: NodeJS.Timeout | null = null;
  private active: boolean = false;
  
  // Callbacks
  private onPeerJoinCallback: ((peer: Peer) => void) | null = null;
  private onOfferCallback: ((from: string, offer: RTCSessionDescriptionInit) => void) | null = null;
  private onAnswerCallback: ((from: string, answer: RTCSessionDescriptionInit) => void) | null = null;
  private onErrorCallback: ((error: Error) => void) | null = null;
  
  constructor(roomId: string, peerId: string, isHost: boolean = false) {
    this.roomId = roomId;
    this.peerId = peerId;
    this.isHost = isHost;
  }
  
  // Join a room - returns a list of existing peers
  async join(): Promise<Peer[]> {
    try {
      this.active = true;
      
      const response = await fetch('/api/signaling', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'join',
          roomId: this.roomId,
          peerId: this.peerId,
          isHost: this.isHost
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to join room: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(`Failed to join room: ${data.error}`);
      }
      
      this.lastPollTimestamp = Date.now();
      this.startPolling();
      
      return data.peers || [];
    } catch (error) {
      this.handleError(error as Error);
      return [];
    }
  }
  
  // Send an offer to a peer
  async sendOffer(targetPeerId: string, offer: RTCSessionDescriptionInit): Promise<boolean> {
    try {
      const response = await fetch('/api/signaling', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'offer',
          roomId: this.roomId,
          peerId: this.peerId,
          target: targetPeerId,
          offer
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to send offer: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.success === true;
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }
  
  // Send an answer to a peer
  async sendAnswer(targetPeerId: string, answer: RTCSessionDescriptionInit): Promise<boolean> {
    try {
      const response = await fetch('/api/signaling', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'answer',
          roomId: this.roomId,
          peerId: this.peerId,
          target: targetPeerId,
          answer
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to send answer: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.success === true;
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }
  
  // Poll for updates (offers, answers, new peers)
  private async poll(): Promise<void> {
    if (!this.active) return;
    
    try {
      const response = await fetch('/api/signaling', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'poll',
          roomId: this.roomId,
          peerId: this.peerId,
          lastPoll: this.lastPollTimestamp
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to poll: ${response.statusText}`);
      }
      
      const data = await response.json() as PollResponse;
      
      if (data.success) {
        this.lastPollTimestamp = data.timestamp;
        
        // Process new peers
        if (data.newPeers && data.newPeers.length > 0) {
          for (const peer of data.newPeers) {
            if (this.onPeerJoinCallback) {
              this.onPeerJoinCallback(peer);
            }
          }
        }
        
        // Process offers
        if (data.offers && data.offers.length > 0) {
          for (const { from, offer } of data.offers) {
            if (this.onOfferCallback) {
              this.onOfferCallback(from, offer);
            }
          }
        }
        
        // Process answers
        if (data.answers && data.answers.length > 0) {
          for (const { from, answer } of data.answers) {
            if (this.onAnswerCallback) {
              this.onAnswerCallback(from, answer);
            }
          }
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
      // Don't call handleError to avoid spamming the error callback
    }
  }
  
  // Start polling for updates
  private startPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    this.pollingInterval = setInterval(() => {
      this.poll();
    }, 2000); // Poll every 2 seconds
  }
  
  // Stop the signaling service
  stop(): void {
    this.active = false;
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
  
  // Handle errors
  private handleError(error: Error): void {
    console.error('Signaling error:', error);
    
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }
  }
  
  // Set callbacks
  onPeerJoin(callback: (peer: Peer) => void): void {
    this.onPeerJoinCallback = callback;
  }
  
  onOffer(callback: (from: string, offer: RTCSessionDescriptionInit) => void): void {
    this.onOfferCallback = callback;
  }
  
  onAnswer(callback: (from: string, answer: RTCSessionDescriptionInit) => void): void {
    this.onAnswerCallback = callback;
  }
  
  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }
} 