import { useState, useEffect } from 'react';
import { X, ChevronRight, Sparkles } from 'lucide-react';
import { hasSeenFlag, markFlagSeen, FLAGS } from '../utils/onboardingState';

const TOUR_STEPS = [
  {
    targetSelector: '[data-tour="demo-class"]',
    title: 'Welcome to TulongGuro!',
    content: 'This is your Demo Class. Click it to explore how TulongGuro works.',
    position: 'bottom',
  },
  {
    targetSelector: '[data-tour="scan-essays"]',
    title: 'Upload Handwritten Work',
    content: 'Click here to upload photos of handwritten student essays for AI grading.',
    position: 'bottom',
  },
  {
    targetSelector: '[data-tour="ai-copilot"]',
    title: 'Your AI Co-Pilot',
    content: 'Need to adjust the AI\'s feedback? Chat with your AI Co-Pilot here.',
    position: 'left',
  },
  {
    targetSelector: '[data-tour="validate-release"]',
    title: 'Validate & Release',
    content: 'When you are happy with the grade, release it to the student. You always have the final say!',
    position: 'top',
  }
];

export default function GuidedTour() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if user has already seen the tour or if they are not a teacher
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'TEACHER' || hasSeenFlag(FLAGS.TEACHER_GUIDED_TOUR)) {
      return;
    }

    // Small delay to allow initial render
    const timer = setTimeout(() => {
      setIsVisible(true);
      updateTargetPosition();
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isVisible) {
      updateTargetPosition();
      
      const handleResize = () => updateTargetPosition();
      window.addEventListener('resize', handleResize);
      window.addEventListener('scroll', handleResize, true);
      
      // Polling to catch dynamically rendered elements
      const interval = setInterval(updateTargetPosition, 1000);
      
      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('scroll', handleResize, true);
        clearInterval(interval);
      };
    }
  }, [isVisible, currentStepIndex]);

  const updateTargetPosition = () => {
    const step = TOUR_STEPS[currentStepIndex];
    if (!step) return;
    
    const element = document.querySelector(step.targetSelector);
    if (element) {
      // Scroll into view if needed
      const rect = element.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          setTargetRect(document.querySelector(step.targetSelector).getBoundingClientRect());
        }, 300);
      } else {
        setTargetRect(rect);
      }
    } else {
      setTargetRect(null); // Element not found on current page
    }
  };

  const handleNext = () => {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      dismissTour();
    }
  };

  const dismissTour = () => {
    setIsVisible(false);
    markFlagSeen(FLAGS.TEACHER_GUIDED_TOUR);
  };

  if (!isVisible) return null;

  const currentStep = TOUR_STEPS[currentStepIndex];

  // Calculate tooltip position based on targetRect
  let tooltipStyle = {};
  if (targetRect) {
    const gap = 12;
    if (currentStep.position === 'bottom') {
      tooltipStyle = { top: targetRect.bottom + gap, left: Math.max(16, targetRect.left) };
    } else if (currentStep.position === 'top') {
      tooltipStyle = { bottom: window.innerHeight - targetRect.top + gap, left: Math.max(16, targetRect.left) };
    } else if (currentStep.position === 'left') {
      tooltipStyle = { top: targetRect.top, right: window.innerWidth - targetRect.left + gap };
    } else if (currentStep.position === 'right') {
      tooltipStyle = { top: targetRect.top, left: targetRect.right + gap };
    }
    
    // Fallback logic to prevent overflowing window bounds
    if (tooltipStyle.left !== undefined && tooltipStyle.left + 320 > window.innerWidth) {
      tooltipStyle.left = window.innerWidth - 336; // 320 width + 16 margin
    }
  } else {
    // If target not found on screen, show at bottom center
    tooltipStyle = { bottom: 24, left: '50%', transform: 'translateX(-50%)' };
  }

  return (
    <>
      {/* Target Spotlight Overlay */}
      {targetRect && (
        <div 
          className="fixed inset-0 z-[100] pointer-events-none transition-all duration-300"
          style={{
            background: `radial-gradient(circle at ${targetRect.left + targetRect.width / 2}px ${targetRect.top + targetRect.height / 2}px, transparent ${Math.max(targetRect.width, targetRect.height) * 0.6}px, rgba(15, 23, 42, 0.6) ${Math.max(targetRect.width, targetRect.height) * 0.7}px)`
          }}
        />
      )}

      {/* Full screen backdrop if no target found to still guide the user */}
      {!targetRect && (
        <div className="fixed inset-0 bg-slate-900/40 z-[90]" />
      )}

      {/* Tooltip Card */}
      <div 
        className="fixed z-[110] w-[320px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-fade-in-up transition-all duration-300"
        style={tooltipStyle}
      >
        <div className="bg-brand-navy p-3 flex items-center justify-between">
          <div className="flex items-center text-white text-sm font-bold">
            <Sparkles className="w-4 h-4 mr-2 text-amber-300" />
            Tour ({currentStepIndex + 1}/{TOUR_STEPS.length})
          </div>
          <button onClick={dismissTour} className="text-white/70 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-1">{currentStep.title}</h3>
          <p className="text-sm text-slate-600 mb-4">{currentStep.content}</p>
          
          <div className="flex items-center justify-between">
            <button 
              onClick={dismissTour}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              Skip Tour
            </button>
            <button 
              onClick={handleNext}
              className="px-4 py-2 bg-brand-green text-white text-sm font-bold rounded-xl hover:bg-emerald-600 transition-colors flex items-center shadow-md shadow-brand-green/20"
            >
              {currentStepIndex === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'} <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
