import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { LogEntry } from '../../core/system/ConsoleLogger';

export const ConsolePanel: React.FC = () => {
  const core = useAppStore((state) => state.core);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!core) return;
    setLogs([...core.logger.getLogs()]);
    core.logger.onLogAdded = () => {
      setLogs([...core.logger.getLogs()]);
    };
    return () => {
      core.logger.onLogAdded = undefined;
    };
  }, [core]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const colorForType = (type: LogEntry['type']) => {
    switch (type) {
      case 'error':   return '#f48771';
      case 'warn':    return '#cca700';
      case 'command': return '#569cd6';
      default:        return '#d4d4d4';
    }
  };

  const prefixForType = (type: LogEntry['type']) => {
    switch (type) {
      case 'error':   return '// Error: ';
      case 'warn':    return '// Warning: ';
      case 'command': return '> ';
      default:        return '';
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#1e1e1e',
      fontFamily: '"Consolas", "Menlo", monospace',
      fontSize: '12px',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 8px',
        backgroundColor: '#252526',
        borderBottom: '1px solid #1a1a1a',
      }}>
        <span style={{ color: '#858585', fontSize: '11px' }}>Script Editor</span>
        <div style={{ flexGrow: 1 }} />
        <button
          onClick={() => setLogs([])}
          style={{
            background: 'none',
            border: '1px solid #555',
            color: '#aaa',
            padding: '1px 8px',
            cursor: 'pointer',
            fontSize: '11px',
            borderRadius: '2px',
          }}
        >
          Clear
        </button>
      </div>

      {/* Log entries */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
        {logs.length === 0 && (
          <div style={{ color: '#555', fontStyle: 'italic', paddingTop: '6px' }}>
            // No output yet
          </div>
        )}
        {logs.map((log, index) => (
          <div
            key={index}
            style={{
              color: colorForType(log.type),
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {prefixForType(log.type)}{log.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
