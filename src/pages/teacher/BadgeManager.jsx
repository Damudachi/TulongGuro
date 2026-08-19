import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Medal, Plus, Edit2, Trash2, X, Loader2, Users, FileText, Check } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { showAlert, showConfirm } from '../../utils/dialog';
import {
  badgeLook, BADGE_ICON_KEYS, BADGE_COLOR_KEYS,
  DEFAULT_BADGE_ICON, DEFAULT_BADGE_COLOR,
} from '../../constants/badgeLook';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const BLANK = { name: '', description: '', icon: DEFAULT_BADGE_ICON, color: DEFAULT_BADGE_COLOR };

/**
 * A teacher's own badges: what they are called, what they look like, and which
 * activities award them.
 *
 * The bar a learner has to clear is deliberately *not* set here. It belongs to
 * the activity, not to the badge — the same "Great Effort" badge can be worth
 * 70% on a first draft and 85% on the final, and a single number stored on the
 * badge would force the teacher to choose one meaning for all of them. So this
 * screen owns the reward, and the Activity Builder owns the condition; this
 * page shows what each activity has chosen so the pair is still readable in
 * one place.
 */
export default function BadgeManager() {
  const [badges, setBadges] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // null = the form is closed. '' = creating. Any other value = editing that id.
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    apiFetch(`${API_URL}/api/teacher/badges`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return setLoadError(d.error || 'Your badges could not be loaded.');
        setBadges(d.badges || []);
      })
      .catch(() => setLoadError('Could not reach the server, so your badges have not been loaded.'))
      .finally(() => setIsLoading(false));
  }, []);

  const openCreate = () => { setEditingId(''); setForm(BLANK); setFormError(''); };
  const openEdit = (badge) => {
    setEditingId(badge.id);
    setForm({
      name: badge.name || '',
      description: badge.description || '',
      icon: badge.icon || DEFAULT_BADGE_ICON,
      color: badge.color || DEFAULT_BADGE_COLOR,
    });
    setFormError('');
  };
  const closeForm = () => { setEditingId(null); setForm(BLANK); setFormError(''); };

  const save = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    // Checked here as well as on the server so the teacher is told before the
    // round trip; the server is what actually enforces it.
    if (!name) return setFormError('Give the badge a name — it is what the learner sees on it.');

    setIsSaving(true);
    setFormError('');
    const isEdit = !!editingId;
    try {
      const res = await apiFetch(
        isEdit ? `${API_URL}/api/teacher/badges/${editingId}` : `${API_URL}/api/teacher/badges`,
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, name }),
        }
      );
      const data = await res.json();
      if (!data.success) return setFormError(data.error || 'That badge could not be saved.');

      setBadges(prev => isEdit
        // The response carries only the badge's own fields, so the counts and
        // the activity list already on screen are preserved rather than being
        // blanked by a spread of a narrower object.
        ? prev.map(b => (b.id === editingId ? { ...b, ...data.badge } : b))
        : [{ ...data.badge, awardedCount: 0, activities: [] }, ...prev]);
      closeForm();
    } catch {
      setFormError('Network error while saving this badge.');
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (badge) => {
    if (!(await showConfirm(`Delete the "${badge.name}" badge? Activities using it will simply stop awarding anything.`,
      { confirmLabel: 'Delete badge', danger: true }))) return;
    setDeletingId(badge.id);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/badges/${badge.id}`, { method: 'DELETE' });
      const data = await res.json();
      // 409 BADGE_AWARDED is the expected refusal, not a failure: a badge a
      // learner already holds cannot be taken off their shelf.
      if (!data.success) return showAlert(data.error || 'That badge could not be deleted.');
      setBadges(prev => prev.filter(b => b.id !== badge.id));
    } catch {
      showAlert('Network error while deleting this badge.');
    } finally {
      setDeletingId(null);
    }
  };

  const preview = badgeLook(form);
  const PreviewIcon = preview.icon;

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-navy-700">Badges</h1>
          <p className="text-sm text-neutral-500 font-semibold mt-1">
            Rewards you write yourself. Attach one to an activity and set the score that earns it.
          </p>
        </div>
        {editingId === null && (
          <button onClick={openCreate}
            className="shrink-0 flex items-center gap-1.5 bg-royal-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-royal-600 transition-colors">
            <Plus className="w-4 h-4" /> New Badge
          </button>
        )}
      </div>

      {/* ── Create / edit ── */}
      {editingId !== null && (
        <form onSubmit={save} className="bg-white p-5 rounded-2xl border-2 border-royal-200 shadow-sm mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-navy-700">{editingId ? 'Edit badge' : 'New badge'}</h2>
            <button type="button" onClick={closeForm} className="text-neutral-400 hover:text-neutral-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* What the learner will actually see, drawn by the same component
              their trophy room draws from — so this is the badge, not an impression
              of it. */}
          <div className={cn('p-4 rounded-2xl border-2 flex items-center gap-4', preview.shell)}>
            <div className={cn('p-3.5 rounded-2xl text-white shrink-0 shadow-pop', preview.tile)}>
              <PreviewIcon className="w-7 h-7" />
            </div>
            <div className="min-w-0">
              <p className="font-display font-extrabold text-navy-700 truncate">
                {form.name.trim() || 'Your badge name'}
              </p>
              <p className="text-xs text-navy-600 mt-0.5">
                {form.description.trim() || 'Your learners will see this description here.'}
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="badge-name" className="block text-sm font-bold text-neutral-700 mb-1">Name *</label>
            <input id="badge-name" type="text" value={form.name} maxLength={60}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-4 py-2 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-royal-500 outline-none"
              placeholder="e.g. Times Table Champion" />
          </div>

          <div>
            <label htmlFor="badge-desc" className="block text-sm font-bold text-neutral-700 mb-1">
              Description <span className="font-semibold text-neutral-400">(optional)</span>
            </label>
            <input id="badge-desc" type="text" value={form.description} maxLength={200}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full px-4 py-2 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-royal-500 outline-none"
              placeholder="Left blank, the badge explains its own condition" />
          </div>

          <div>
            <p className="block text-sm font-bold text-neutral-700 mb-2">Icon</p>
            {/* Wraps rather than scrolls: fifteen icons at a fixed cell size fit
                three rows on a phone, and a horizontal scroller would hide half
                the choices behind a gesture nothing signposts. */}
            <div className="flex flex-wrap gap-2">
              {BADGE_ICON_KEYS.map(key => {
                const Icon = badgeLook({ icon: key }).icon;
                const active = form.icon === key;
                return (
                  <button key={key} type="button" aria-pressed={active} aria-label={key}
                    onClick={() => setForm({ ...form, icon: key })}
                    className={cn('w-11 h-11 rounded-xl grid place-items-center border-2 transition-all',
                      active ? cn(preview.tile, 'text-white border-transparent shadow-pop')
                             : 'bg-white border-neutral-200 text-neutral-500 hover:border-royal-300')}>
                    <Icon className="w-5 h-5" />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="block text-sm font-bold text-neutral-700 mb-2">Colour</p>
            <div className="flex flex-wrap gap-2">
              {BADGE_COLOR_KEYS.map(key => {
                const style = badgeLook({ color: key });
                const active = form.color === key;
                return (
                  <button key={key} type="button" aria-pressed={active} aria-label={key}
                    onClick={() => setForm({ ...form, color: key })}
                    className={cn('w-11 h-11 rounded-xl grid place-items-center border-2 transition-all',
                      style.dot, active ? 'border-navy-700 shadow-pop' : 'border-transparent opacity-70 hover:opacity-100')}>
                    {active && <Check className="w-5 h-5 text-white" />}
                  </button>
                );
              })}
            </div>
          </div>

          {formError && (
            <p role="alert" className="text-sm font-bold text-red-700 bg-red-50 border-2 border-red-200 rounded-xl px-4 py-2.5">
              {formError}
            </p>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={isSaving}
              className="flex items-center gap-1.5 bg-royal-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-royal-600 disabled:opacity-60 transition-colors">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editingId ? 'Save changes' : 'Create badge'}
            </button>
            <button type="button" onClick={closeForm}
              className="px-4 py-2 rounded-xl text-sm font-bold text-neutral-600 hover:bg-neutral-100 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ── The library ── */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500 py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your badges…
        </div>
      ) : loadError ? (
        <p role="alert" className="text-sm font-bold text-red-700 bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3">
          {loadError}
        </p>
      ) : badges.length === 0 ? (
        <div className="text-center text-neutral-400 py-14 border-2 border-dashed border-neutral-200 rounded-2xl">
          <Medal className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-bold text-neutral-500">No badges yet</p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            Create one, then attach it to an activity and choose the score a learner has to reach to earn it.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {badges.map(badge => {
            const style = badgeLook(badge);
            const Icon = style.icon;
            return (
              <div key={badge.id} className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className={cn('p-3 rounded-2xl text-white shrink-0 shadow-pop', style.tile)}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-extrabold text-navy-700">{badge.name}</p>
                    {badge.description && (
                      <p className="text-xs text-neutral-500 mt-0.5">{badge.description}</p>
                    )}
                    <div className="flex items-center gap-3 flex-wrap mt-2 text-[11px] font-bold text-neutral-500">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {badge.awardedCount === 1 ? '1 learner has earned it' : `${badge.awardedCount} learners have earned it`}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {badge.activities?.length === 1 ? 'On 1 activity' : `On ${badge.activities?.length || 0} activities`}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(badge)} aria-label={`Edit ${badge.name}`}
                      className="p-2 rounded-lg text-neutral-400 hover:text-royal-600 hover:bg-royal-50 transition-colors">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => remove(badge)} disabled={deletingId === badge.id}
                      aria-label={`Delete ${badge.name}`}
                      className="p-2 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors">
                      {deletingId === badge.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Which activities award it, and at what mark. The bar lives on
                    the activity, so this is the only place the whole rule —
                    reward plus condition — can be read at a glance. */}
                {badge.activities?.length > 0 && (
                  <ul className="mt-3 pt-3 border-t border-neutral-100 space-y-1.5">
                    {badge.activities.map(a => (
                      <li key={a.id} className="flex items-center justify-between gap-3 text-xs">
                        <Link to={`/teacher/activity/edit/${a.id}`}
                          className="font-bold text-navy-600 hover:text-royal-600 truncate">
                          {a.title}
                          {a.class?.name && <span className="font-semibold text-neutral-400"> · {a.class.name}</span>}
                        </Link>
                        <span className={cn('shrink-0 font-extrabold px-2 py-0.5 rounded-full', style.shell, style.ink, 'border')}>
                          {a.badgePassingScore != null ? `${a.badgePassingScore}% to earn` : 'No score set'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
