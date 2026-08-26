import React, { useEffect, useState } from 'react';
import { CheckCircle, X } from 'lucide-react';

export interface ToastMessage {
    title: string;
    body?: string;
}

interface ToastProps {
    message: ToastMessage | null;
    onClose: () => void;
    duration?: number; // ms, default 4000
}

export const Toast: React.FC<ToastProps> = ({ message, onClose, duration = 4000 }) => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!message) { setVisible(false); return; }
        setVisible(true);
        const timer = setTimeout(() => {
            setVisible(false);
            setTimeout(onClose, 300); // wait for fade-out
        }, duration);
        return () => clearTimeout(timer);
    }, [message, duration, onClose]);

    if (!message) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            background: '#1e1e1e',
            border: '1px solid #3b82f6',
            borderRadius: '8px',
            padding: '14px 18px',
            minWidth: '260px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.25s ease, transform 0.25s ease',
            pointerEvents: visible ? 'auto' : 'none',
        }}>
            <CheckCircle size={20} color="#22c55e" style={{ flexShrink: 0, marginTop: '1px' }} />
            <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: '13px' }}>{message.title}</div>
                {message.body && (
                    <div style={{ color: '#888', fontSize: '12px', marginTop: '3px' }}>{message.body}</div>
                )}
            </div>
            <button
                onClick={() => { setVisible(false); setTimeout(onClose, 300); }}
                style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0', lineHeight: 1 }}
            >
                <X size={14} />
            </button>
        </div>
    );
};
