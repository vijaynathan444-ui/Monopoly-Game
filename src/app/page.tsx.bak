'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socketClient';

export default function HomePage() {
  const router = useRouter();
  const [createName, setCreateName] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Initialize socket connection on page load so it's ready when user clicks
  useEffect(() => {
    getSocket();
  }, []);

  const emitWithRetry = (socket: ReturnType<typeof getSocket>, event: string, payload: Record<string, unknown>, onResult: (res: Record<string, unknown>) => void) => {
    const timeout = setTimeout(() => {
      setLoading(false);
      setError('Connection timed out. Please try again.');
    }, 15000);

    const doEmit = () => {
      socket.emit(event, payload, (res: Record<string, unknown>) => {
        clearTimeout(timeout);
        onResult(res);
      });
    };

    if (socket.connected) {
      doEmit();
    } else {
      // Ensure server is initialized before reconnecting
      fetch('/api/socketio').catch(() => {});
      if (socket.disconnected) {
        socket.connect();
      }
      socket.once('connect', doEmit);
    }
  };

  const handleCreate = () => {
    if (!createName.trim()) {
      setError('Please enter your name');
      return;
    }
    setLoading(true);
    setError('');
    const socket = getSocket();

    emitWithRetry(socket, 'create_room', { playerName: createName.trim() }, (res) => {
      setLoading(false);
      if (res.success) {
        sessionStorage.setItem('userId', res.userId as string);
        sessionStorage.setItem('roomId', res.roomId as string);
        sessionStorage.setItem('roomCode', res.roomCode as string);
        sessionStorage.setItem('playerName', createName.trim());
        router.push(`/lobby/${res.roomCode}`);
      } else {
        setError((res.error as string) || 'Failed to create room');
      }
    });
  };

  const handleJoin = () => {
    if (!joinName.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!joinCode.trim()) {
      setError('Please enter room code');
      return;
    }
    setLoading(true);
    setError('');
    const socket = getSocket();
    const code = joinCode.trim().toUpperCase();

    emitWithRetry(socket, 'join_room', { playerName: joinName.trim(), roomCode: code }, (res) => {
      setLoading(false);
      if (res.success) {
        sessionStorage.setItem('userId', res.userId as string);
        sessionStorage.setItem('roomId', res.roomId as string);
        sessionStorage.setItem('roomCode', code);
        sessionStorage.setItem('playerName', joinName.trim());
        router.push(`/lobby/${code}`);
      } else {
        setError((res.error as string) || 'Failed to join room');
      }
    });
  };

  return (
    <div className="home-container">
      <h1 className="home-title">MONOPOLY</h1>
      <p className="home-subtitle">Create or join a room to play with friends</p>

      {error && <p className="error-text">{error}</p>}

      <div className="home-cards">
        <div className="home-card">
          <h2>Create Room</h2>
          <p>Start a new game and invite your friends</p>
          <div className="input-group">
            <input
              className="input-field"
              type="text"
              placeholder="Your name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              maxLength={20}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <button className="btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : 'Create Room'}
          </button>
        </div>

        <div className="home-card">
          <h2>Join Room</h2>
          <p>Enter a room code to join a friend&#39;s game</p>
          <div className="input-group">
            <input
              className="input-field"
              type="text"
              placeholder="Your name"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              maxLength={20}
            />
            <input
              className="input-field"
              type="text"
              placeholder="Room Code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
          </div>
          <button className="btn-primary" onClick={handleJoin} disabled={loading}>
            {loading ? 'Joining...' : 'Join Room'}
          </button>
        </div>
      </div>
    </div>
  );
}
