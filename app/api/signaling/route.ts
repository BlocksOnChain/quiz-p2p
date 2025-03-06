import { NextRequest, NextResponse } from 'next/server';

// In-memory store for active rooms and peers
// In a production environment, you'd use a more persistent solution
interface PeerInfo {
  peerId: string;
  lastSeen: number;
  offers: {
    from: string;
    offer: any;
    timestamp: number;
  }[];
  answers: {
    from: string;
    answer: any;
    timestamp: number;
  }[];
}

interface RoomInfo {
  hostPeerId?: string;
  peers: Map<string, PeerInfo>;
  created: number;
  lastActivity: number;
}

// Store active rooms
const rooms = new Map<string, RoomInfo>();

// Clean up inactive peers and rooms (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const PEER_TIMEOUT = 2 * 60 * 1000; // 2 minutes
const ROOM_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

// Handle cleanup of inactive peers and rooms
setInterval(() => {
  const now = Date.now();
  
  // Clean up inactive rooms
  for (const [roomId, roomInfo] of rooms.entries()) {
    // Remove inactive peers
    for (const [peerId, peerInfo] of roomInfo.peers.entries()) {
      if (now - peerInfo.lastSeen > PEER_TIMEOUT) {
        roomInfo.peers.delete(peerId);
        console.log(`Removed inactive peer ${peerId} from room ${roomId}`);
      }
    }
    
    // Remove room if it's inactive or has no peers
    if (now - roomInfo.lastActivity > ROOM_TIMEOUT || roomInfo.peers.size === 0) {
      rooms.delete(roomId);
      console.log(`Removed inactive room ${roomId}`);
    }
  }
}, CLEANUP_INTERVAL);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, roomId, peerId, offer, answer, target } = body;
    
    // Handle invalid requests
    if (!action || !roomId || !peerId) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    
    const now = Date.now();
    
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        peers: new Map(),
        created: now,
        lastActivity: now
      });
    }
    
    // Get room info
    const room = rooms.get(roomId)!;
    room.lastActivity = now;
    
    // Create peer if it doesn't exist
    if (!room.peers.has(peerId)) {
      room.peers.set(peerId, {
        peerId,
        lastSeen: now,
        offers: [],
        answers: []
      });
    }
    
    // Update peer last seen
    const peer = room.peers.get(peerId)!;
    peer.lastSeen = now;
    
    // Handle action
    switch (action) {
      case 'join': {
        // If peer is announcing as host, register them
        if (body.isHost) {
          room.hostPeerId = peerId;
        }
        
        // Return other peers in the room
        const peers = Array.from(room.peers.keys())
          .filter(id => id !== peerId)
          .map(id => ({
            peerId: id,
            isHost: id === room.hostPeerId
          }));
          
        return NextResponse.json({ 
          success: true,
          peers,
          isHost: peerId === room.hostPeerId,
          hostPeerId: room.hostPeerId
        });
      }
      
      case 'offer': {
        // Validate request
        if (!target || !offer) {
          return NextResponse.json({ error: 'Invalid offer' }, { status: 400 });
        }
        
        // Store offer
        if (!room.peers.has(target)) {
          room.peers.set(target, {
            peerId: target,
            lastSeen: now - 60000, // Set as slightly older
            offers: [],
            answers: []
          });
        }
        
        const targetPeer = room.peers.get(target)!;
        targetPeer.offers.push({
          from: peerId,
          offer,
          timestamp: now
        });
        
        return NextResponse.json({ success: true });
      }
      
      case 'answer': {
        // Validate request
        if (!target || !answer) {
          return NextResponse.json({ error: 'Invalid answer' }, { status: 400 });
        }
        
        // Store answer
        if (!room.peers.has(target)) {
          return NextResponse.json({ error: 'Target peer not found' }, { status: 404 });
        }
        
        const targetPeer = room.peers.get(target)!;
        targetPeer.answers.push({
          from: peerId,
          answer,
          timestamp: now
        });
        
        return NextResponse.json({ success: true });
      }
      
      case 'poll': {
        // Get offers for this peer
        const offers = Array.from(room.peers.values())
          .flatMap(p => p.offers)
          .filter(o => o.from !== peerId && o.timestamp > (body.lastPoll || 0));
        
        // Get answers for this peer
        const answers = Array.from(room.peers.values())
          .flatMap(p => p.answers)
          .filter(a => a.from !== peerId && a.timestamp > (body.lastPoll || 0));
        
        // Clean up processed offers and answers
        for (const p of room.peers.values()) {
          p.offers = p.offers.filter(o => o.timestamp > now - 60000);
          p.answers = p.answers.filter(a => a.timestamp > now - 60000);
        }
        
        // Check for new peers
        const newPeers = Array.from(room.peers.keys())
          .filter(id => id !== peerId && room.peers.get(id)!.lastSeen > (body.lastPoll || 0))
          .map(id => ({
            peerId: id,
            isHost: id === room.hostPeerId
          }));
        
        return NextResponse.json({
          success: true,
          offers,
          answers,
          newPeers,
          timestamp: now
        });
      }
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  }
  catch (error) {
    console.error('Signaling error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function GET() {
  // Simple health check endpoint
  return NextResponse.json({
    status: 'ok',
    rooms: rooms.size,
    timestamp: Date.now()
  });
} 