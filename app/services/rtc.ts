'use client';

import { SignalingService } from './signaling';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { 
    urls: 'turn:global.turn.twilio.com:3478',
    username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
    credential: 'w1uxM55V9yVoqyVFjt+mxDBV0F87AUCemaYVQGxsPLw='
  }
];

const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10
};

interface Peer {
  peerId: string;
  isHost: boolean;
}

// Add a connection state enum to track the WebRTC connection state
enum ConnectionState {
  NEW,
  CONNECTING,
  OFFER_SENT,
  OFFER_RECEIVED,
  ANSWER_SENT,
  ANSWER_RECEIVED,
  CONNECTED,
  DISCONNECTED,
  FAILED
}

interface PeerConnection {
  peerId: string;
  isHost: boolean;
  connection: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  isInitiator: boolean;
  connected: boolean;
  state: ConnectionState; // Add state tracking for the connection
  processingSignal: boolean; // Flag to prevent concurrent signaling operations
}

interface MessageEvent {
  from: string;
  type: string;
  data: any;
}

export class RTCService {
  private roomId: string;
  private peerId: string;
  private isHost: boolean;
  private signaling: SignalingService;
  private connections: Map<string, PeerConnection> = new Map();
  
  // Callbacks
  private onConnectionCallback: ((peerId: string) => void) | null = null;
  private onDisconnectionCallback: ((peerId: string) => void) | null = null;
  private onMessageCallback: ((event: MessageEvent) => void) | null = null;
  private onErrorCallback: ((error: Error) => void) | null = null;
  private onPeerCountChangeCallback: ((count: number) => void) | null = null;
  
  constructor(roomId: string, isHost: boolean = false) {
    this.roomId = roomId;
    this.peerId = generateId();
    this.isHost = isHost;
    this.signaling = new SignalingService(roomId, this.peerId, isHost);
    
    // Set up signaling callbacks
    this.signaling.onPeerJoin(this.handlePeerJoin.bind(this));
    this.signaling.onOffer(this.handleOffer.bind(this));
    this.signaling.onAnswer(this.handleAnswer.bind(this));
    this.signaling.onError(this.handleSignalingError.bind(this));
  }
  
  // Start the RTC service and join a room
  async start(): Promise<void> {
    try {
      const peers = await this.signaling.join();
      
      // Connect to existing peers - only if we're the host
      // For non-hosts, wait for them to initiate the connection
      if (this.isHost) {
        for (const peer of peers) {
          this.connectToPeer(peer.peerId, peer.isHost, true);
        }
      }
      
      this.updatePeerCount();
    } catch (error) {
      this.handleError(error as Error);
    }
  }
  
  // Handle a new peer joining
  private handlePeerJoin(peer: Peer): void {
    // If we're the host, we initiate the connection
    // Otherwise, we wait for an offer
    if (this.isHost) {
      this.connectToPeer(peer.peerId, peer.isHost, true);
    }
    
    this.updatePeerCount();
  }
  
  // Connect to a peer
  private async connectToPeer(peerId: string, isHost: boolean, isInitiator: boolean): Promise<void> {
    // Don't connect to ourselves or if we already have a connection
    if (peerId === this.peerId) {
      return;
    }
    
    // Check if we already have a connection to this peer
    const existingConnection = this.connections.get(peerId);
    if (existingConnection) {
      // If connection is already in progress or established, don't create a new one
      if (existingConnection.state !== ConnectionState.DISCONNECTED && 
          existingConnection.state !== ConnectionState.FAILED) {
        console.log(`Connection to peer ${peerId} already exists, skipping`);
        return;
      }
      
      // If we have a failed connection, clean it up first
      console.log(`Cleaning up failed connection to peer ${peerId}`);
      if (existingConnection.dataChannel) {
        existingConnection.dataChannel.close();
      }
      existingConnection.connection.close();
      this.connections.delete(peerId);
    }
    
    try {
      // Create RTCPeerConnection
      const connection = new RTCPeerConnection(RTC_CONFIG);
      
      // Create data channel if we're the initiator
      let dataChannel: RTCDataChannel | undefined;
      
      if (isInitiator) {
        dataChannel = connection.createDataChannel('quiz-data', {
          ordered: true
        });
        this.setupDataChannel(dataChannel, peerId);
      }
      
      // Store the connection with initial state
      this.connections.set(peerId, {
        peerId,
        isHost,
        connection,
        dataChannel,
        isInitiator,
        connected: false,
        state: ConnectionState.NEW,
        processingSignal: false
      });
      
      // Set up ICE candidate handling
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          // In a real implementation, we would send this candidate to the peer
          console.log('ICE candidate:', event.candidate);
        }
      };
      
      // Handle ICE connection state changes
      connection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for peer ${peerId}: ${connection.iceConnectionState}`);
        
        if (connection.iceConnectionState === 'failed') {
          console.log(`ICE connection failed for peer ${peerId}, reconnecting...`);
          // Try to reconnect
          const peerConn = this.connections.get(peerId);
          if (peerConn) {
            peerConn.state = ConnectionState.FAILED;
            // Schedule reconnection attempt
            setTimeout(() => {
              this.connectToPeer(peerId, isHost, isInitiator);
            }, 1000);
          }
        }
      };
      
      // Handle connection state changes
      connection.onconnectionstatechange = () => {
        const peerConnection = this.connections.get(peerId);
        if (!peerConnection) return;
        
        console.log(`Connection state for peer ${peerId}: ${connection.connectionState}`);
        
        switch (connection.connectionState) {
          case 'connected':
            peerConnection.state = ConnectionState.CONNECTED;
            if (!peerConnection.connected) {
              peerConnection.connected = true;
              if (this.onConnectionCallback) {
                this.onConnectionCallback(peerId);
              }
              this.updatePeerCount();
            }
            break;
          case 'disconnected':
            peerConnection.state = ConnectionState.DISCONNECTED;
            if (peerConnection.connected) {
              peerConnection.connected = false;
              if (this.onDisconnectionCallback) {
                this.onDisconnectionCallback(peerId);
              }
              this.updatePeerCount();
            }
            break;
          case 'failed':
            peerConnection.state = ConnectionState.FAILED;
            if (peerConnection.connected) {
              peerConnection.connected = false;
              if (this.onDisconnectionCallback) {
                this.onDisconnectionCallback(peerId);
              }
              this.updatePeerCount();
            }
            break;
          case 'closed':
            peerConnection.state = ConnectionState.DISCONNECTED;
            if (peerConnection.connected) {
              peerConnection.connected = false;
              if (this.onDisconnectionCallback) {
                this.onDisconnectionCallback(peerId);
              }
              this.updatePeerCount();
            }
            break;
        }
      };
      
      // Set a timeout for ICE connection
      setTimeout(() => {
        const peerConn = this.connections.get(peerId);
        if (peerConn && !peerConn.connected && peerConn.state !== ConnectionState.CONNECTED) {
          console.log(`Connection timeout for peer ${peerId}, reconnecting...`);
          // Set state to failed and try to reconnect
          peerConn.state = ConnectionState.FAILED;
          this.connectToPeer(peerId, isHost, isInitiator);
        }
      }, 10000); // 10 second timeout
      
      // Set up data channel handling if we're not the initiator
      connection.ondatachannel = (event) => {
        const peerConnection = this.connections.get(peerId);
        if (peerConnection) {
          peerConnection.dataChannel = event.channel;
          this.setupDataChannel(event.channel, peerId);
        }
      };
      
      // If we're the initiator, create and send an offer
      if (isInitiator) {
        await this.createAndSendOffer(peerId);
      }
    } catch (error) {
      this.handleError(error as Error);
    }
  }
  
  // Create and send an offer
  private async createAndSendOffer(peerId: string): Promise<void> {
    const peerConnection = this.connections.get(peerId);
    if (!peerConnection) return;
    
    // If we're already fully connected, no need to send an offer
    if (peerConnection.state === ConnectionState.CONNECTED) {
      console.log('Already connected to peer, skipping offer creation');
      return;
    }
    
    // If we're already processing a signal, schedule a retry
    if (peerConnection.processingSignal) {
      console.log('Already processing a signal for this peer, will retry offer creation');
      setTimeout(() => this.createAndSendOffer(peerId), 500);
      return;
    }
    
    // Set the processing flag
    peerConnection.processingSignal = true;
    
    try {
      // More forgiving state checking
      const invalidStates = [
        ConnectionState.OFFER_SENT, 
        ConnectionState.OFFER_RECEIVED,
        ConnectionState.ANSWER_SENT,
        ConnectionState.ANSWER_RECEIVED, 
        ConnectionState.CONNECTED
      ];
      
      if (invalidStates.includes(peerConnection.state)) {
        console.log(`Invalid state for creating offer: ${peerConnection.state}`);
        return;
      }
      
      // Update the state
      peerConnection.state = ConnectionState.CONNECTING;
      
      // Create the offer
      const offer = await peerConnection.connection.createOffer();
      await peerConnection.connection.setLocalDescription(offer);
      
      // Update the state
      peerConnection.state = ConnectionState.OFFER_SENT;
      
      // Send the offer via signaling
      await this.signaling.sendOffer(peerId, offer);
      
      console.log(`Sent offer to peer ${peerId}`);
    } catch (error) {
      this.handleError(error as Error);
    } finally {
      // Clear the processing flag
      peerConnection.processingSignal = false;
    }
  }
  
  // Handle an offer from a peer
  private async handleOffer(from: string, offer: RTCSessionDescriptionInit): Promise<void> {
    try {
      // Connect to the peer if we're not already connected
      let peerConnection = this.connections.get(from);
      
      if (!peerConnection) {
        await this.connectToPeer(from, false, false);
        peerConnection = this.connections.get(from);
        if (!peerConnection) return;
      }
      
      // If we're already fully connected, no need to process another offer
      if (peerConnection.state === ConnectionState.CONNECTED) {
        console.log('Already connected to peer, ignoring offer');
        return;
      }
      
      // If we're already processing a signal, schedule a retry
      if (peerConnection.processingSignal) {
        console.log('Already processing a signal for this peer, will retry offer handling');
        setTimeout(() => this.handleOffer(from, offer), 500);
        return;
      }
      
      // Set the processing flag
      peerConnection.processingSignal = true;
      
      try {
        // Less restrictive state checking - allow processing offers in more states
        // as long as we haven't sent our own offer or received an answer
        const invalidStates = [ConnectionState.OFFER_SENT, ConnectionState.ANSWER_RECEIVED, ConnectionState.CONNECTED];
        if (invalidStates.includes(peerConnection.state)) {
          console.log(`Invalid state for receiving offer: ${peerConnection.state}`);
          return;
        }
        
        // Update the state
        peerConnection.state = ConnectionState.OFFER_RECEIVED;
        
        // Set remote description
        const offerDesc = new RTCSessionDescription(offer);
        await peerConnection.connection.setRemoteDescription(offerDesc);
        
        // Create answer
        const answer = await peerConnection.connection.createAnswer();
        await peerConnection.connection.setLocalDescription(answer);
        
        // Update the state
        peerConnection.state = ConnectionState.ANSWER_SENT;
        
        // Send answer via signaling
        await this.signaling.sendAnswer(from, answer);
        
        console.log(`Sent answer to peer ${from}`);
      } finally {
        // Clear the processing flag
        peerConnection.processingSignal = false;
      }
    } catch (error) {
      this.handleError(error as Error);
    }
  }
  
  // Handle an answer from a peer
  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit): Promise<void> {
    try {
      const peerConnection = this.connections.get(from);
      
      // If we don't have a connection yet, create one first - could be due to race conditions
      if (!peerConnection) {
        console.log(`No connection found for peer ${from}, setting up connection and trying again`);
        await this.connectToPeer(from, false, true);
        // Schedule a retry after connection is set up
        setTimeout(() => this.handleAnswer(from, answer), 500);
        return;
      }
      
      // If we're already fully connected, no need to process an answer
      if (peerConnection.state === ConnectionState.CONNECTED) {
        console.log('Already connected to peer, ignoring answer');
        return;
      }
      
      // If we're already processing a signal, schedule a retry
      if (peerConnection.processingSignal) {
        console.log('Already processing a signal for this peer, will retry answer handling');
        setTimeout(() => this.handleAnswer(from, answer), 500);
        return;
      }
      
      // Set the processing flag
      peerConnection.processingSignal = true;
      
      try {
        // More forgiving state check - if we're in any state before ANSWER_RECEIVED, process the answer
        // This helps with race conditions where offers/answers might arrive out of order
        const invalidStates = [ConnectionState.ANSWER_RECEIVED, ConnectionState.CONNECTED];
        if (invalidStates.includes(peerConnection.state)) {
          console.log(`Invalid state for receiving answer: ${peerConnection.state}`);
          return;
        }
        
        // Set remote description
        const answerDesc = new RTCSessionDescription(answer);
        await peerConnection.connection.setRemoteDescription(answerDesc);
        
        // Update the state
        peerConnection.state = ConnectionState.ANSWER_RECEIVED;
        
        console.log(`Processed answer from peer ${from}`);
      } finally {
        // Clear the processing flag
        peerConnection.processingSignal = false;
      }
    } catch (error) {
      this.handleError(error as Error);
    }
  }
  
  // Set up a data channel
  private setupDataChannel(channel: RTCDataChannel, peerId: string): void {
    channel.onopen = () => {
      console.log(`Data channel open for peer ${peerId}`);
      
      // Update the connected state
      const peerConnection = this.connections.get(peerId);
      if (peerConnection) {
        peerConnection.connected = true;
        peerConnection.state = ConnectionState.CONNECTED;
        if (this.onConnectionCallback) {
          this.onConnectionCallback(peerId);
        }
        this.updatePeerCount();
      }
    };
    
    channel.onclose = () => {
      console.log(`Data channel closed for peer ${peerId}`);
      
      // Update the connected state
      const peerConnection = this.connections.get(peerId);
      if (peerConnection) {
        peerConnection.connected = false;
        peerConnection.state = ConnectionState.DISCONNECTED;
        if (this.onDisconnectionCallback) {
          this.onDisconnectionCallback(peerId);
        }
        this.updatePeerCount();
      }
    };
    
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (this.onMessageCallback) {
          this.onMessageCallback({
            from: peerId,
            type: message.type,
            data: message.data
          });
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
  }
  
  // Send a message to a specific peer
  async sendToPeer(peerId: string, type: string, data: any): Promise<boolean> {
    const peerConnection = this.connections.get(peerId);
    if (!peerConnection || !peerConnection.dataChannel || peerConnection.dataChannel.readyState !== 'open') {
      return false;
    }
    
    try {
      const message = JSON.stringify({
        type,
        data
      });
      
      peerConnection.dataChannel.send(message);
      return true;
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }
  
  // Send a message to all connected peers
  async broadcast(type: string, data: any): Promise<void> {
    for (const [peerId, connection] of this.connections.entries()) {
      if (connection.connected && connection.dataChannel && connection.dataChannel.readyState === 'open') {
        this.sendToPeer(peerId, type, data);
      }
    }
  }
  
  // Get the number of connected peers
  getConnectedPeerCount(): number {
    let count = 0;
    for (const connection of this.connections.values()) {
      if (connection.connected) {
        count++;
      }
    }
    return count;
  }
  
  // Update peer count and call callback if needed
  private updatePeerCount(): void {
    const count = this.getConnectedPeerCount();
    if (this.onPeerCountChangeCallback) {
      this.onPeerCountChangeCallback(count);
    }
  }
  
  // Stop the RTC service
  stop(): void {
    // Close all connections
    for (const [peerId, connection] of this.connections.entries()) {
      if (connection.dataChannel) {
        connection.dataChannel.close();
      }
      connection.connection.close();
    }
    
    this.connections.clear();
    
    // Stop signaling
    this.signaling.stop();
  }
  
  // Handle signaling errors
  private handleSignalingError(error: Error): void {
    console.error('Signaling error:', error);
    this.handleError(error);
  }
  
  // Handle errors
  private handleError(error: Error): void {
    console.error('RTC error:', error);
    
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }
  }
  
  // Set callbacks
  onConnection(callback: (peerId: string) => void): void {
    this.onConnectionCallback = callback;
  }
  
  onDisconnection(callback: (peerId: string) => void): void {
    this.onDisconnectionCallback = callback;
  }
  
  onMessage(callback: (event: MessageEvent) => void): void {
    this.onMessageCallback = callback;
  }
  
  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }
  
  onPeerCountChange(callback: (count: number) => void): void {
    this.onPeerCountChangeCallback = callback;
  }
}

// Generate a unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
} 