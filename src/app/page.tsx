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

  const handleCreate = () => {
    if (!createName.trim()) {
      setError('Please enter your name');
      return;
    }
    setLoading(true);
    setError('');
    const socket = getSocket();
    const timeout = setTimeout(() => {
      setLoading(false);
      setError('Connection timed out. Please try again.');
    }, 15000);

    const doEmit = () => {
      socket.emit('create_room', { playerName: createName.trim() }, (res: {
        success: boolean;
        error?: string;
        roomCode?: string;
        roomId?: string;
        userId?: string;
      }) => {
        clearTimeout(timeout);
        setLoading(false);
        if (res.success) {
          sessionStorage.setItem('userId', res.userId!);
          sessionStorage.setItem('roomId', res.roomId!);
          sessionStorage.setItem('roomCode', res.roomCode!);
          sessionStorage.setItem('playerName', createName.trim());
          router.push(`/lobby/${res.roomCode}`);
        } else {
          setError(res.error || 'Failed to create room');
        }
      });
    };

    if (socket.connected) {
      doEmit();
    } else {
      socket.once('connect', doEmit);
    }
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
    const timeout = setTimeout(() => {
      setLoading(false);
      setError('Connection timed out. Please try again.');
    }, 15000);

    const doJoin = () => {
      socket.emit('join_room', {
        playerName: joinName.trim(),
        roomCode: joinCode.trim().toUpperCase()
      }, (res: {
        success: boolean;
        error?: string;
        roomId?: string;
        userId?: string;
      }) => {
        clearTimeout(timeout);
        setLoading(false);
        if (res.success) {
          sessionStorage.setItem('userId', res.userId!);
          sessionStorage.setItem('roomId', res.roomId!);
          sessionStorage.setItem('roomCode', joinCode.trim().toUpperCase());
          sessionStorage.setItem('playerName', joinName.trim());
          router.push(`/lobby/${joinCode.trim().toUpperCase()}`);
        } else {
          setError(res.error || 'Failed to join room');
        }
      });
    };

    if (socket.connected) {
      doJoin();
    } else {
      socket.once('connect', doJoin);
    }
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
