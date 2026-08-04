import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2, Sparkles, Bot } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { API_URL, apiFetch } from '../config';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const WELCOME_MESSAGE = {
  role: 'ai',
  text: "Hi! I'm your Study Buddy. Ask me anything about your feedback, grades, or how to improve your writing! Kaya mo 'yan! 💪",
};

const QUICK_REPLIES = [
  'Why did I get this score?',
  'How can I improve?',
  'What does this feedback mean?',
];

export default function StudentChatbot({ initialMessage }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPulse, setShowPulse] = useState(true);
  const [initialSent, setInitialSent] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Stop the pulse animation after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowPulse(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Deep-link: listen for 'open-study-buddy' events from other components (e.g., OutputDetails)
  const sendMessageRef = useRef(null);
  const contextRef = useRef(null);

  useEffect(() => {
    const handleDeepLink = (e) => {
      const msg = e.detail?.message;
      const ctx = e.detail?.context;
      
      if (ctx) {
        contextRef.current = ctx;
      }

      if (msg) {
        setIsOpen(true);
        // Small delay to ensure drawer is rendered before sending
        setTimeout(() => {
          if (sendMessageRef.current) sendMessageRef.current(msg);
        }, 400);
      } else {
        setIsOpen(true);
      }
    };
    window.addEventListener('open-study-buddy', handleDeepLink);
    return () => window.removeEventListener('open-study-buddy', handleDeepLink);
  }, []);

  const getStudentId = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}').id;
    } catch {
      return null;
    }
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      if (!text.trim() || isLoading) return;

      const studentId = getStudentId();
      const userMessage = { role: 'user', text: text.trim() };
      const updatedMessages = [...messages, userMessage];

      setMessages(updatedMessages);
      setInput('');
      setIsLoading(true);

      try {
        const conversationHistory = updatedMessages.map((m) => ({
          role: m.role,
          text: m.text,
        }));

        const payload = {
          studentId,
          message: text.trim(),
          conversationHistory,
          context: contextRef.current // Send the specific assignment context if available
        };

        const res = await apiFetch(`${API_URL}/api/student/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (data.success) {
          setMessages((prev) => [...prev, { role: 'ai', text: data.reply }]);
        } else {
          setMessages((prev) => [
            ...prev,
            { role: 'ai', text: 'Sorry, something went wrong. Please try again later.' },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: 'ai', text: 'Cannot connect to server. Please check your connection.' },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, getStudentId]
  );

  // Keep ref in sync for deep-link event handler
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  // Deep-link: auto-send initialMessage when drawer first opens
  useEffect(() => {
    if (isOpen && initialMessage && !initialSent) {
      setInitialSent(true);
      sendMessage(initialMessage);
    }
  }, [isOpen, initialMessage, initialSent, sendMessage]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleQuickReply = (text) => {
    sendMessage(text);
  };

  const toggleOpen = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <>
      {/* Floating Action Button */}
      {!isOpen && (
        <button
          onClick={toggleOpen}
          className={cn(
            "fixed right-4 z-50 flex items-center justify-center",
            "w-14 h-14 rounded-full bg-brand-green text-white shadow-lg",
            "hover:bg-emerald-600 hover:shadow-xl hover:scale-105",
            "transition-all duration-300 ease-out",
            "bottom-[5rem] md:bottom-6"
          )}
          aria-label="Open Study Buddy chat"
        >
          {/* Pulse ring */}
          {showPulse && (
            <span className="absolute inset-0 rounded-full bg-brand-green animate-ping opacity-40" />
          )}
          <MessageCircle className="w-6 h-6 relative z-10" />
        </button>
      )}

      {/* Chat Drawer */}
      {isOpen && (
        <div
          className={cn(
            "fixed z-50 flex flex-col bg-white shadow-2xl",
            "inset-0",
            "md:inset-auto md:right-0 md:top-0 md:bottom-0 md:w-[380px]",
            "md:border-l md:border-slate-200"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-brand-green to-emerald-600 text-white shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-bold text-base leading-tight">Study Buddy 📚</h2>
                <p className="text-xs text-white/80">AI Learning Assistant</p>
              </div>
            </div>
            <button
              onClick={toggleOpen}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/20 transition-colors"
              aria-label="Close chat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex",
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {msg.role === 'ai' && (
                  <div className="flex items-start gap-2 max-w-[85%]">
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-brand-green/10 shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 text-brand-green" />
                    </div>
                    <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-white border border-slate-200 text-sm text-brand-slate leading-relaxed shadow-sm">
                      {msg.text}
                    </div>
                  </div>
                )}
                {msg.role === 'user' && (
                  <div className="max-w-[85%]">
                    <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-brand-green text-white text-sm leading-relaxed shadow-sm">
                      {msg.text}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-start gap-2">
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-brand-green/10 shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-brand-green" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                      <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                      <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Replies */}
          {messages.length <= 1 && !isLoading && (
            <div className="flex gap-2 px-4 py-2 overflow-x-auto bg-white border-t border-slate-100 shrink-0">
              {QUICK_REPLIES.map((text) => (
                <button
                  key={text}
                  onClick={() => handleQuickReply(text)}
                  className="shrink-0 px-3 py-1.5 text-xs font-medium text-brand-green bg-green-50 border border-green-200 rounded-full hover:bg-green-100 transition-colors whitespace-nowrap"
                >
                  {text}
                </button>
              ))}
            </div>
          )}

          {/* Input Area */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 px-4 py-3 bg-white border-t border-slate-200 shrink-0"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything..."
              disabled={isLoading}
              className={cn(
                "flex-1 px-4 py-2.5 rounded-full border border-slate-200 text-sm",
                "focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green outline-none",
                "transition-all placeholder:text-slate-400",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-full",
                "bg-brand-green text-white shadow-sm",
                "hover:bg-emerald-600 hover:shadow-md",
                "transition-all duration-200",
                "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-green disabled:hover:shadow-sm"
              )}
              aria-label="Send message"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
