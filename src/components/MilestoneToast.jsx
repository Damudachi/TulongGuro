import { useState, useEffect } from 'react';
import { X, Sparkles, CheckCircle2, Flame, Star } from 'lucide-react';
import { hasSeenFlag, markFlagSeen } from '../utils/onboardingState';

/**
 * Event emitter for triggering toasts globally.
 * Usage:
 *   import { triggerMilestone } from './MilestoneToast';
 *   triggerMilestone('FIRST_VALIDATE');
 */
const MILESTONE_EVENTS = new EventTarget();

export const triggerMilestone = (milestoneKey) => {
  if (hasSeenFlag(milestoneKey)) return; // Don't trigger if already achieved
  const event = new CustomEvent('milestone', { detail: { key: milestoneKey } });
  MILESTONE_EVENTS.dispatchEvent(event);
};

const MILESTONE_CONFIG = {
  FIRST_VALIDATE: {
    icon: Sparkles,
    iconColor: 'text-amber-400',
    title: 'First Grade Released! 🎉',
    message: 'You just saved ~5 minutes of manual grading.',
    confetti: true,
  },
  FIRST_5_PAPERS: {
    icon: Flame,
    iconColor: 'text-orange-500',
    title: 'On a Roll! 🔥',
    message: '5 papers graded! That\'s ~25 minutes saved.',
    confetti: true,
  },
  SECTION_COMPLETE: {
    icon: Star,
    iconColor: 'text-yellow-400',
    title: 'Section Complete! ⭐',
    message: 'Every student in this section has been graded.',
    confetti: true,
  },
  DEMO_CLEARED: {
    icon: Sparkles,
    iconColor: 'text-emerald-400',
    title: 'Clean Slate! ✨',
    message: 'You\'re ready to add your real students.',
    confetti: false,
  }
};

// Lightweight CSS Confetti Component
const Confetti = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-[200] overflow-hidden flex justify-center">
      {Array.from({ length: 50 }).map((_, i) => {
        const left = Math.random() * 100;
        const animationDuration = 1 + Math.random() * 2;
        const animationDelay = Math.random() * 0.5;
        const colors = ['bg-red-500', 'bg-blue-500', 'bg-yellow-500', 'bg-green-500', 'bg-purple-500'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        return (
          <div
            key={i}
            className={`absolute top-[-10px] w-2 h-3 rounded-sm opacity-80 animate-confetti-fall ${color}`}
            style={{
              left: `${left}%`,
              animationDuration: `${animationDuration}s`,
              animationDelay: `${animationDelay}s`
            }}
          />
        );
      })}
    </div>
  );
};

export default function MilestoneToast() {
  const [activeToast, setActiveToast] = useState(null);

  useEffect(() => {
    const handleMilestone = (e) => {
      const config = MILESTONE_CONFIG[e.detail.key];
      if (config) {
        setActiveToast({ ...config, key: e.detail.key });
        markFlagSeen(e.detail.key);
        // Auto-dismiss after 5 seconds
        setTimeout(() => setActiveToast(null), 5000);
      }
    };

    MILESTONE_EVENTS.addEventListener('milestone', handleMilestone);
    return () => MILESTONE_EVENTS.removeEventListener('milestone', handleMilestone);
  }, []);

  if (!activeToast) return null;

  const Icon = activeToast.icon;

  return (
    <>
      {activeToast.confetti && <Confetti />}
      <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 z-[150] animate-fade-in-up">
        <div className="bg-brand-navy border border-slate-700 shadow-2xl rounded-2xl p-4 w-80 relative overflow-hidden">
          {/* Subtle shine effect */}
          <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/0 transform translate-x-[-100%] animate-shine" />
          
          <button 
            onClick={() => setActiveToast(null)}
            className="absolute top-3 right-3 text-white/50 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          
          <div className="flex items-start gap-3">
            <div className={`p-2 bg-white/10 rounded-xl shrink-0 ${activeToast.iconColor}`}>
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm mb-1 pr-4">{activeToast.title}</h3>
              <p className="text-blue-200 text-xs leading-relaxed">{activeToast.message}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
