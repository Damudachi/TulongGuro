import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Reusable component for empty states with actionable coaching.
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.icon - Lucide icon component (e.g. <BarChart2 />)
 * @param {string} props.title - Title of the empty state
 * @param {string} props.description - Coaching description
 * @param {string} props.ctaText - Text for the primary action button
 * @param {string} props.ctaLink - Path to link to
 */
export default function EmptyStateCoach({ icon, title, description, ctaText, ctaLink }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 max-w-md mx-auto text-center animate-fade-in-up">
      <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center text-brand-navy mb-6 shadow-inner border border-blue-100">
        <div className="w-10 h-10">
          {icon}
        </div>
      </div>
      <h2 className="text-xl font-bold text-brand-slate mb-3">{title}</h2>
      <p className="text-slate-500 text-sm mb-8 leading-relaxed">
        {description}
      </p>
      {ctaLink && ctaText && (
        <Link 
          to={ctaLink}
          className="inline-flex items-center justify-center px-6 py-3 bg-brand-navy text-white text-sm font-bold rounded-xl hover:bg-blue-900 transition-all shadow-md shadow-brand-navy/20 hover:shadow-lg hover:-translate-y-0.5"
        >
          {ctaText} <ArrowRight className="w-4 h-4 ml-2" />
        </Link>
      )}
    </div>
  );
}
