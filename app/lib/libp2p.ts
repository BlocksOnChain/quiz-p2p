'use client';

import { type Libp2p, createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { webRTC, WebRTCTransportInit } from '@libp2p/webrtc';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { gossipsub, GossipSub } from '@chainsafe/libp2p-gossipsub';
import { bootstrap } from '@libp2p/bootstrap';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { fromString, toString } from 'uint8arrays';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { kadDHT } from '@libp2p/kad-dht';
import { multiaddr } from '@multiformats/multiaddr';

let node: Libp2p | null = null;
let peerIdString: string | null = null;

// Custom signaling topic for direct peer discovery
const CUSTOM_SIGNALING_TOPIC = 'quiz-p2p-custom-discovery';

// We use known public bootstrap nodes for initial connection
const DEFAULT_BOOTSTRAP_ADDRESSES: string[] = [
  '/dns4/bootstrap.libp2p.io/tcp/443/wss/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dns4/bootstrap.libp2p.io/tcp/443/wss/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dns4/bootstrap.libp2p.io/tcp/443/wss/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dns4/bootstrap.libp2p.io/tcp/443/wss/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
  // IPFS public signaling servers
  '/dns4/webrtc-star.discovery.libp2p.io/tcp/443/wss/p2p-webrtc-star',
  '/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star',
  '/dns4/wrtc-star2.sjc.dwebops.pub/tcp/443/wss/p2p-webrtc-star'
];

// Public STUN servers for WebRTC NAT traversal
const PUBLIC_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.ekiga.net' },
  { urls: 'stun:stun.ideasip.com' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

// TURN server for fallback when direct connections fail
const TURN_SERVER = { 
  urls: 'turn:global.turn.twilio.com:3478',
  username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
  credential: 'w1uxM55V9yVoqyVFjt+mxDBV0F87AUCemaYVQGxsPLw='
};

// Check if we're in a secure context with crypto API available
const isCryptoAvailable = (): boolean => {
  return typeof window !== 'undefined' && 
         typeof window.crypto !== 'undefined' && 
         typeof window.crypto.subtle !== 'undefined';
};

// Get bootstrap addresses from environment variable or use defaults
const getBootstrapAddresses = (): string[] => {
  if (typeof window !== 'undefined') {
    const envAddrs = process.env.NEXT_PUBLIC_BOOTSTRAP_ADDRS;
    if (envAddrs) {
      try {
        return JSON.parse(envAddrs);
      } catch (e) {
        console.error('Failed to parse bootstrap addresses:', e);
      }
    }
  }
  return DEFAULT_BOOTSTRAP_ADDRESSES;
};

// Create and initialize a libp2p node
export const initLibp2p = async (): Promise<Libp2p> => {
  if (node) {
    return node;
  }

  // Check if crypto API is available (required for libp2p)
  if (!isCryptoAvailable()) {
    throw new Error(
      "Web Crypto API not available. This app requires a secure context (HTTPS) " +
      "or localhost for P2P functionality. If you're using a development server, " +
      "please use https or localhost instead of an IP address."
    );
  }

  // Enable libp2p debug logs in development
  if (process.env.NODE_ENV === 'development' && typeof localStorage !== 'undefined') {
    localStorage.setItem('debug', 'libp2p:*');
  }

  const bootstrapAddresses = getBootstrapAddresses();

  // Create WebRTC configuration with more options
  const webRTCOptions: WebRTCTransportInit = {
    rtcConfiguration: {
      iceServers: [...PUBLIC_STUN_SERVERS, TURN_SERVER],
      iceCandidatePoolSize: 10 // Increase candidate pool for better connectivity
    }
  };

  node = await createLibp2p({
    addresses: {
      listen: [
        // WebRTC transport for direct browser-to-browser connections
        '/webrtc'
      ]
    },
    transports: [
      webSockets(),
      webRTC(webRTCOptions),
      circuitRelayTransport()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionManager: {
      maxConnections: 100 // Allow more connections for better connectivity
    },
    peerDiscovery: [
      bootstrap({
        list: bootstrapAddresses,
        timeout: 5000, // Longer timeout for bootstrap
        tagName: 'bootstrap', // Tag bootstrap nodes to prefer them
        tagValue: 100, // High value for bootstrap nodes
        tagTTL: 120 * 60 * 1000 // 2 hours tag time-to-live
      }),
      pubsubPeerDiscovery({
        interval: 5000, // Announce every 5 seconds
        listenOnly: false // Both listen and publish
      })
    ],
    services: {
      identify: identify({
        protocolPrefix: 'ipfs', // Use IPFS prefix for wider compatibility
        agentVersion: 'quiz-p2p/1.0' // Custom agent version for debugging
      }),
      pubsub: gossipsub({ 
        allowPublishToZeroTopicPeers: true,
        emitSelf: true, // Receive our own published messages
        heartbeatInterval: 700, // Faster heartbeats for quicker connection detection
        floodPublish: true, // Publish messages to all peers, not just mesh peers
        directPeers: [] // Will be populated with known peer addresses
      }),
      dht: kadDHT({
        clientMode: false, // Run as a full DHT node, not just a client
        kBucketSize: 20 // Increase k-bucket size for better routing
      })
    }
  });

  // Store peerId for direct connections
  peerIdString = node.peerId.toString();

  // Log peer discovery and connection events
  node.addEventListener('peer:discovery', (evt) => {
    console.log('Peer discovered:', evt.detail.toString());
  });

  node.addEventListener('peer:connect', (evt) => {
    console.log('Connected to peer:', evt.detail.toString());
  });

  node.addEventListener('peer:disconnect', (evt) => {
    console.log('Disconnected from peer:', evt.detail.toString());
  });

  // Start the libp2p node
  await node.start();
  console.log('libp2p node started with PeerId:', node.peerId.toString());
  console.log('Using bootstrap addresses:', bootstrapAddresses);

  // Start custom signaling (separate from pubsub-peer-discovery)
  await startCustomSignaling(node);

  return node;
};

// Start custom signaling on a separate topic to avoid conflicts with pubsub-peer-discovery
const startCustomSignaling = async (node: Libp2p): Promise<void> => {
  const pubsub = node.services.pubsub as GossipSub;
  
  // Get bootstrap addresses
  const bootstrapAddrs = getBootstrapAddresses();
  
  // Subscribe to our custom signaling topic (different from pubsub-peer-discovery's default)
  await pubsub.subscribe(CUSTOM_SIGNALING_TOPIC);
  
  // Announce our peer ID periodically
  setInterval(async () => {
    try {
      // Simple string message format to avoid protobuf decoding issues
      const message = JSON.stringify({
        type: 'peer-announce',
        peerId: node.peerId.toString(),
        timestamp: Date.now(),
        addresses: node.getMultiaddrs().map(addr => addr.toString())
      });
      
      await pubsub.publish(CUSTOM_SIGNALING_TOPIC, fromString(message));
    } catch (error) {
      console.error('Error publishing to custom signaling topic:', error instanceof Error ? error.message : 'Unknown error');
    }
  }, 5000); // Every 5 seconds
  
  // Listen for other peers
  pubsub.addEventListener('message', async (evt: { detail: { topic: string; data: Uint8Array } }) => {
    if (evt.detail.topic === CUSTOM_SIGNALING_TOPIC) {
      try {
        // Simple string message format that won't conflict with pubsub-peer-discovery
        const messageString = toString(evt.detail.data);
        const message = JSON.parse(messageString);
        
        if (message && 
            message.type === 'peer-announce' && 
            message.peerId && 
            message.peerId !== node.peerId.toString()) {
          console.log('Discovered peer via custom signaling:', message.peerId);
          
          // Try to connect to this peer directly
          try {
            // Add peer's multiaddrs if available
            if (message.addresses && Array.isArray(message.addresses)) {
              for (const addrStr of message.addresses) {
                try {
                  const ma = multiaddr(addrStr);
                  // Store the address for this peer (without using addressBook directly)
                  try {
                    await node.peerStore.patch(message.peerId, {
                      multiaddrs: [ma]
                    });
                    console.log('Added address for peer:', message.peerId);
                  } catch (err) {
                    console.warn('Failed to patch peer store:', err instanceof Error ? err.message : 'Unknown error');
                  }
                } catch (_) {
                  // Use underscore for unused variable instead of 'e'
                  console.warn('Invalid multiaddr:', addrStr);
                }
              }
            }
            
            // Try multiple dial attempts with exponential backoff
            const tryDial = async (attempt = 1, maxAttempts = 3) => {
              try {
                await node.dial(message.peerId);
                console.log('Successfully connected to peer:', message.peerId);
                return true;
              } catch (error) {
                if (attempt < maxAttempts) {
                  const delay = 1000 * Math.pow(2, attempt); // Exponential backoff
                  console.log(`Dial attempt ${attempt} failed, retrying in ${delay}ms...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                  return tryDial(attempt + 1, maxAttempts);
                } else {
                  console.warn('Failed to dial peer after multiple attempts:', error instanceof Error ? error.message : error);
                  return false;
                }
              }
            };
            
            tryDial();
          } catch (error) {
            if (error instanceof Error) {
              console.warn('Failed to dial discovered peer:', error.message);
            } else {
              console.warn('Failed to dial discovered peer:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error processing custom signaling message:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  });

  // Regularly attempt to connect to known bootstrap nodes
  setInterval(async () => {
    try {
      for (const addrStr of getBootstrapAddresses()) {
        try {
          // Convert the string address to a multiaddr before dialing
          const ma = multiaddr(addrStr);
          await node.dial(ma);
          console.log(`Connected to bootstrap node: ${addrStr}`);
          break; // Stop after finding one that works
        } catch (error) {
          // No need to assign to a variable
          console.log(`Failed to connect to bootstrap node: ${addrStr}`);
        }
      }
    } catch (error) {
      console.warn('Bootstrap connection failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }, 60000); // Every minute
};

// Get the current node's peer ID string
export const getPeerId = (): string | null => {
  return peerIdString;
};

// Clean shutdown of the libp2p node
export const stopLibp2p = async (): Promise<void> => {
  if (node) {
    await node.stop();
    node = null;
    console.log('libp2p node stopped');
  }
};

// Helper for encoding/decoding messages with proper type annotations
export const encodeMessage = (data: Record<string, unknown>): Uint8Array => {
  return fromString(JSON.stringify(data));
};

export const decodeMessage = (bytes: Uint8Array): Record<string, unknown> | null => {
  try {
    return JSON.parse(toString(bytes));
  } catch (error) {
    // No need to assign to a variable
    console.error('Failed to decode message');
    return null;
  }
}; 