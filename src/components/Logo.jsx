import logoUrl from '../assets/logo.png';

/**
 * The TulongGuro mark.
 *
 * One component because the brand lockup appears in six places — the landing
 * nav and footer, the login panel, and all three role sidebars — and each one
 * had previously grown its own hand-rolled `BookOpen`-in-a-tinted-tile, which
 * is how they ended up at three different sizes and three different plate
 * colours.
 *
 * The mark sits bare rather than on a plate: it is already a colourful cluster,
 * so a royal or sun tile behind it only fights the artwork. Everywhere it is
 * used the word "TulongGuro" sits right beside it, so it is decorative for
 * screen readers — an `alt` here would just make every sidebar announce the
 * brand name twice.
 */

const SIZES = {
  sm: 'w-8 h-8',   // footer
  md: 'w-10 h-10', // landing nav
  lg: 'w-11 h-11', // sidebars, login panel
};

export default function Logo({ size = 'md', className = '' }) {
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      width="44"
      height="44"
      className={`${SIZES[size] || SIZES.md} shrink-0 object-contain ${className}`}
    />
  );
}
