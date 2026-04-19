'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socketClient';

export default function HomePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loadingAction, setLoadingAction] = useState<'play' | 'private' | 'join' | ''>('');

  useEffect(() => {
    getSocket();
    const saved = sessionStorage.getItem('playerName');
    if (saved) setNickname(saved);
  }, []);

  const emitWithRetry = (
    socket: ReturnType<typeof getSocket>,
    event: string,
    payload: Record<string, unknown>,
    onResult: (res: Record<string, unknown>) => void,
  ) => {
    const timeout = setTimeout(() => {
      setLoadingAction('');
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
      fetch('/api/socketio').catch(() => {});
      if (socket.disconnected) socket.connect();
      socket.once('connect', doEmit);
    }
  };

  const ensureNickname = () => {
    if (!nickname.trim()) {
      setError('Please enter your nickname');
      return false;
    }
    setError('');
    sessionStorage.setItem('playerName', nickname.trim());
    return true;
  };

  const handleBrowseRooms = () => {
    if (!ensureNickname()) return;
    setLoadingAction('play');
    router.push('/rooms');
  };

  const handleCreatePrivate = () => {
    if (!ensureNickname()) return;
    setLoadingAction('private');
    const socket = getSocket();

    emitWithRetry(socket, 'create_room', {
      playerName: nickname.trim(),
      isPrivate: true,
    }, (res) => {
      setLoadingAction('');
      if (res.success) {
        sessionStorage.setItem('userId', res.userId as string);
        sessionStorage.setItem('roomId', res.roomId as string);
        sessionStorage.setItem('roomCode', res.roomCode as string);
        router.push(`/lobby/${res.roomCode}`);
      } else {
        setError((res.error as string) || 'Failed to create private room');
      }
    });
  };

  const handleJoinByCode = () => {
    if (!ensureNickname()) return;
    if (!joinCode.trim()) {
      setError('Please enter room code');
      return;
    }

    setLoadingAction('join');
    const code = joinCode.trim().toUpperCase();
    const socket = getSocket();

    emitWithRetry(socket, 'join_room', {
      playerName: nickname.trim(),
      roomCode: code,
    }, (res) => {
      setLoadingAction('');
      if (res.success) {
        sessionStorage.setItem('userId', res.userId as string);
        sessionStorage.setItem('roomId', res.roomId as string);
        sessionStorage.setItem('roomCode', code);
        router.push(`/lobby/${code}`);
      } else {
        setError((res.error as string) || 'Failed to join room');
      }
    });
  };

  return (
    <div className="home-container modern-home">
      <div className="home-bg-icons" aria-hidden="true">
        <span className="bg-icon" style={{ top: '9%', left: '7%', animationDelay: '0s' }}>🎲</span>
        <span className="bg-icon" style={{ top: '18%', right: '8%', animationDelay: '1s' }}>🏦</span>
        <span className="bg-icon" style={{ bottom: '14%', left: '12%', animationDelay: '2s' }}>💎</span>
        <span className="bg-icon" style={{ top: '60%', right: '10%', animationDelay: '1.5s' }}>🚂</span>
        <span className="bg-icon" style={{ bottom: '9%', right: '18%', animationDelay: '2.5s' }}>💡</span>
      </div>

      <div className="home-shell">
        <div className="home-hero">
          <div className="home-dice-icon">🎲</div>
          <h1 className="home-title">MONOPOLY</h1>
          <p className="home-subtitle">Create public rooms, private rooms, and jump into live matches with a cleaner multiplayer flow.</p>
        </div>

        {error && <p className="error-text home-error">{error}</p>}

        <div className="home-play-section">
          <input
            className="input-field home-nickname-input"
            type="text"
            placeholder="Your nickname..."
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              setError('');
            }}
            maxLength={20}
            onKeyDown={(e) => e.key === 'Enter' && handleBrowseRooms()}
          />

          <button className="home-play-btn btn-primary" onClick={handleBrowseRooms} disabled={loadingAction !== ''}>
            {loadingAction === 'play' ? 'Opening...' : 'Play'}
          </button>
        </div>

        <div className="home-action-btns">
          <button className="home-action-btn" onClick={handleBrowseRooms} disabled={loadingAction !== ''}>
            👥 Browse existing rooms
          </button>
          <button className="home-action-btn accent" onClick={handleCreatePrivate} disabled={loadingAction !== ''}>
            {loadingAction === 'private' ? 'Creating...' : '🔐 Create private room'}
          </button>
        </div>

        <div className="home-join-bar">
          <input
            className="input-field"
            type="text"
            placeholder="Enter room code"
            value={joinCode}
            onChange={(e) => {
              setJoinCode(e.target.value.toUpperCase());
              setError('');
            }}
            maxLength={6}
            onKeyDown={(e) => e.key === 'Enter' && handleJoinByCode()}
          />
          <button className="btn-secondary home-join-btn" onClick={handleJoinByCode} disabled={loadingAction !== ''}>
            {loadingAction === 'join' ? 'Joining...' : 'Join by code'}
          </button>
        </div>
      </div>
    </div>
  );
}
