import React, { useRef, useState, useEffect, useCallback } from 'react';

const backendUrl = 'http://localhost:8000'; // Default, change if running on remote

export default function PrismikCanvas() {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [ctx, setCtx] = useState(null);

  // Agent State
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  
  // Interruption State
  const [currentMessage, setCurrentMessage] = useState('');
  const [isInterrupting, setIsInterrupting] = useState(false);

  // Background check lock
  const isCheckingRef = useRef(false);
  const hasChangedRef = useRef(true);

  const drawNotebookBackground = (context, width, height) => {
    // Fill white/off-white background
    context.fillStyle = '#fdfbf7';
    context.fillRect(0, 0, width, height);

    // Draw horizontal blue lines
    context.lineWidth = 1;
    context.strokeStyle = '#e0e6ed';
    const lineSpacing = 40;
    for (let y = 60; y < height; y += lineSpacing) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    // Draw vertical red margin
    context.strokeStyle = '#fca5a5';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(80, 0);
    context.lineTo(80, height);
    context.stroke();
    
    // Reset drawing defaults for the user
    context.lineCap = 'round';
    context.lineWidth = 4;
    context.strokeStyle = '#1e293b'; // dark blue/black ink
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const context = canvas.getContext('2d');
      drawNotebookBackground(context, canvas.width, canvas.height);
      setCtx(context);
    }

    const handleResize = () => {
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        const context = canvas.getContext('2d');
        drawNotebookBackground(context, canvas.width, canvas.height);
        setCtx(context);
        hasChangedRef.current = true;
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Stop talking on hot-reload/unmount
      }
    };
  }, []);

  const startDrawing = (e) => {
    if (!ctx) return;
    setIsDrawing(true);
    ctx.beginPath();
    const { clientX, clientY } = e.touches ? e.touches[0] : e;
    ctx.moveTo(clientX, clientY);
  };

  const draw = (e) => {
    if (!isDrawing || !ctx) return;
    const { clientX, clientY } = e.touches ? e.touches[0] : e;
    ctx.lineTo(clientX, clientY);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!ctx) return;
    setIsDrawing(false);
    ctx.closePath();
    hasChangedRef.current = true;
  };

  const getCanvasBlob = async () => {
    return new Promise((resolve) => {
      if (canvasRef.current) {
        canvasRef.current.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.8);
      } else {
        resolve(null);
      }
    });
  };

  // TTS Helper
  const speakText = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Stop any current speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  // STT Handlers
  const handleTalk = () => {
    if (!agentEnabled) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech Recognition API not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('Listening...');
      setCurrentMessage('');
    };

    recognition.onresult = async (event) => {
      const resultText = event.results[0][0].transcript;
      setTranscript(resultText);
      setIsListening(false);
      
      // Send question and canvas image to backend
      const blob = await getCanvasBlob();
      if (!blob) return;

      const formData = new FormData();
      formData.append('canvasImage', blob, 'canvas.jpg');
      formData.append('questionText', resultText);

      try {
        setTranscript(`Sending: "${resultText}"...`);
        const response = await fetch(`${backendUrl}/ask`, {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        const answer = data.answerText || "I couldn't generate an answer.";
        setCurrentMessage(`Prismik: ${answer}`);
        speakText(answer);
        setTranscript('');
      } catch (err) {
        console.error("Ask error:", err);
        setTranscript('Error submitting question.');
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
      if (event.error === 'no-speech') {
        setTranscript("Didn't catch that. Please click again and start speaking.");
      } else {
        setTranscript('Speech recognition error: ' + event.error);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  // 5-second polling loop
  useEffect(() => {
    const timer = setInterval(async () => {
      if (isCheckingRef.current) return;
      if (!hasChangedRef.current) return; // Skip if no new user edits!
      
      isCheckingRef.current = true;
      try {
        const blob = await getCanvasBlob();
        if (blob) {
          hasChangedRef.current = false; // reset flag upon capture
          const formData = new FormData();
          formData.append('canvasImage', blob, 'canvas.jpg');

          const response = await fetch(`${backendUrl}/analyze-image`, {
            method: 'POST',
            body: formData,
          });
          const data = await response.json();
          
          if (data.action === 'interrupt' && data.message) {
            setIsInterrupting(true);
            setCurrentMessage(`INTERRUPTION: ${data.message}`);
            speakText(data.message);
            // Auto hide interruption message after some time
            setTimeout(() => {
              setIsInterrupting(false);
              setCurrentMessage('');
            }, 8000);
          }
        }
      } catch (err) {
        console.error("Safety check error:", err);
      } finally {
        isCheckingRef.current = false;
      }
    }, 5000);

    return () => clearInterval(timer);
  }, []);


  return (
    <div className="relative w-full h-screen overflow-hidden bg-transparent touch-none">
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        className="absolute top-0 left-0 w-full h-full cursor-crosshair"
      />

      {/* Top Floating UI */}
      <div className="absolute top-4 left-0 right-0 p-4 pointer-events-none flex flex-col items-center">
        {/* Interruption / Message Banner */}
        {currentMessage && (
           <div className={`px-6 py-4 rounded-xl shadow-2xl max-w-2xl pointer-events-auto transition-all flex items-center justify-between space-x-4 ${isInterrupting ? 'bg-red-600 border-2 border-red-300' : 'bg-slate-800/90 border border-slate-600'} text-white font-medium`}>
              <span>{currentMessage}</span>
              <button 
                onClick={() => {
                  if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                  }
                  setCurrentMessage('');
                  setIsInterrupting(false);
                }}
                className="ml-4 bg-white/20 hover:bg-white/30 text-white rounded-full p-2 focus:outline-none transition-colors"
                title="Stop speaking"
              >
                {/* Stop Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
              </button>
           </div>
        )}
      </div>

      {/* Bottom Floating Controls */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex items-center space-x-6 bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-slate-700 pointer-events-auto">
        
        {/* Agent Toggle */}
        <label className="flex items-center cursor-pointer">
          <div className="relative">
            <input 
              type="checkbox" 
              className="sr-only" 
              checked={agentEnabled} 
              onChange={() => setAgentEnabled(!agentEnabled)} 
            />
            <div className={`block w-14 h-8 rounded-full transition-colors ${agentEnabled ? 'bg-indigo-500' : 'bg-slate-600'}`}></div>
            <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${agentEnabled ? 'transform translate-x-6' : ''}`}></div>
          </div>
          <div className="ml-3 text-white font-medium select-none">Agent</div>
        </label>

        {/* Talk Button */}
        <div className="h-8 w-px bg-slate-600"></div>
        
        <button 
          onClick={handleTalk}
          disabled={!agentEnabled || isListening}
          className={`flex items-center justify-center px-6 py-3 rounded-xl font-bold transition-all shadow-lg active:scale-95 text-white ${!agentEnabled ? 'bg-slate-700 opacity-50 cursor-not-allowed' : isListening ? 'bg-rose-500 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-500 hover:shadow-indigo-500/25'}`}
        >
          {isListening ? (
            <span className="flex items-center">
              <span className="w-2 h-2 bg-white rounded-full animate-bounce mr-1"></span>
              <span className="w-2 h-2 bg-white rounded-full animate-bounce mr-1" style={{ animationDelay: '0.1s' }}></span>
              <span className="w-2 h-2 bg-white rounded-full animate-bounce mr-2" style={{ animationDelay: '0.2s' }}></span>
              Listening
            </span>
          ) : (
            'Talk to Prismik'
          )}
        </button>
      </div>

      {transcript && !isListening && (
         <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 bg-slate-900/80 text-slate-300 px-4 py-2 rounded-lg text-sm border border-slate-700">
           {transcript}
         </div>
      )}
    </div>
  );
}
