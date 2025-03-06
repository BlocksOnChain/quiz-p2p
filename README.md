# P2P Quiz Application

A real-time, browser-based quiz application using libp2p for peer-to-peer networking, built with Next.js and TypeScript.

## Overview

This application enables a quiz creator to publish questions that participants receive simultaneously in real-time through peer-to-peer communication. Questions are displayed to participants after a 5-second synchronization delay to ensure fair gameplay.

The app uses:
- **libp2p** for peer-to-peer networking
- **Next.js** with **TypeScript** for the frontend
- **WebSockets** and **WebRTC** for browser-based P2P connections

## Features

- **Create Quiz**: Host a new quiz session and generate a unique room code
- **Join Quiz**: Join an existing quiz using a room code
- **Real-time Question Publishing**: Questions are delivered to all participants simultaneously
- **5-Second Delay**: Synchronized question display across all participants
- **Answer Submission**: Participants can submit answers that are sent back to the host
- **Multiple Choice or Text Answers**: Support for both question types

## Getting Started

### Prerequisites

- Node.js 16+ and npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/quiz-p2p.git
cd quiz-p2p
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Creating a Quiz

1. Navigate to "Create Quiz" from the home page
2. Enter a name for your quiz
3. Share the generated room code with participants
4. Create and publish questions to all connected participants

### Joining a Quiz

1. Navigate to "Join Quiz" from the home page
2. Enter the room code provided by the quiz host
3. Wait for questions to appear and submit answers

## How It Works

The application uses libp2p, a modular networking stack, to establish direct peer-to-peer connections between browsers:

1. When a user creates or joins a quiz, a libp2p node is initialized in their browser
2. The app uses a topic-based publish/subscribe system (GossipSub) for broadcasting questions and answers
3. All messages are encrypted using the Noise protocol
4. A 5-second delay is applied before displaying questions to ensure synchronization
5. No central server is needed for the quiz logic - all communication is direct P2P

## Bootstrap/Relay Configuration

For peer discovery and connectivity, the application needs bootstrap/relay nodes. In the development version, we're using public bootstrap nodes, but for production, you should run your own relay servers for better reliability.

### Setting Up a Bootstrap/Relay Node

You can set up your own bootstrap/relay server using Node.js. Here's a simple example:

1. Create a new directory for your relay server:
```bash
mkdir quiz-relay
cd quiz-relay
npm init -y
```

2. Install the required dependencies:
```bash
npm install libp2p @libp2p/tcp @libp2p/websockets @chainsafe/libp2p-noise @chainsafe/libp2p-yamux @libp2p/bootstrap @libp2p/circuit-relay-v2 @libp2p/identify
```

3. Create a `relay.js` file:
```javascript
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'

const main = async () => {
  // Create the libp2p node
  const node = await createLibp2p({
    addresses: {
      listen: [
        '/ip4/0.0.0.0/tcp/9090',
        '/ip4/0.0.0.0/tcp/9091/ws'
      ]
    },
    transports: [
      tcp(),
      webSockets()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      relay: circuitRelayServer({
        reservations: {
          // Allow anyone to connect and use our bandwidth
          maxReservations: Infinity
        }
      })
    }
  })

  // Start the node
  await node.start()

  console.log('libp2p relay has started')
  console.log('Listening on:')
  node.getMultiaddrs().forEach((ma) => {
    console.log(`${ma.toString()}/p2p/${node.peerId.toString()}`)
  })
}

main().catch(err => {
  console.error('Error starting relay:', err)
  process.exit(1)
})
```

4. Run the relay server:
```bash
node relay.js
```

### Configuring the Quiz App to Use Your Relay

Once your relay server is running, you can configure the quiz app to use it by setting the `NEXT_PUBLIC_BOOTSTRAP_ADDRS` environment variable. Create a `.env.local` file in your quiz app directory:

```
NEXT_PUBLIC_BOOTSTRAP_ADDRS='["/ip4/your-server-ip/tcp/9091/ws/p2p/YOUR_RELAY_PEER_ID"]'
```

Replace `your-server-ip` and `YOUR_RELAY_PEER_ID` with your relay server's actual IP address and PeerId.

### Hosting Considerations

- For production use, your relay server should have a static IP or domain name
- Consider using HTTPS (WSS) for secure WebSocket connections
- You can run multiple relay servers for redundancy and better geographic coverage
- Cloud platforms like AWS, Azure, or DigitalOcean are good options for hosting relay servers

## Troubleshooting

### Common Issues

1. **Connection Problems**:
   - The most common issue with P2P applications is establishing connections through firewalls/NATs
   - The application will automatically fallback to using relay servers if direct connections cannot be established
   - If connections fail completely, try using a different network or ensure your relay servers are accessible

2. **Slow Message Delivery**:
   - If messages are taking too long to arrive, it might be due to relay server congestion
   - Consider running your own relay servers with better bandwidth
   - The 5-second delay helps mitigate most timing issues

3. **Browser Compatibility**:
   - This application works best in modern browsers that support WebRTC
   - Chrome, Firefox, and Edge provide the best experience
   - Safari has limited WebRTC support in some versions

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [libp2p](https://libp2p.io/)
- [Next.js](https://nextjs.org/)
- [IPFS](https://ipfs.io/) for inspiration on P2P systems
