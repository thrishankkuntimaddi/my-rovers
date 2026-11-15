import { DriveButton, NavMenu } from '../components/Futuristic';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import { ACHIEVEMENTS, LESSONS, academy, lessonsDone, levelOf, LEVELS } from '../state/academy';

export function Academy({ onLesson }: { onLesson(id: string): void }) {
  const a = useStore(academy);
  const { done } = useStore(lessonsDone);
  const lv = levelOf(a.xp);
  const unlocked = ACHIEVEMENTS.filter((x) => a.unlocked[x.id]).length;
  const nextLesson = LESSONS.find((l) => !done[l.id]);
  return (
    <section className="screen tabscreen">
      <header className="lg-header lg-bar page-head">
        <NavMenu />
        <div className="head-actions"><span className="lg-chip">{a.xp} XP</span><DriveButton /></div>
      </header>
      <div className="lg-scroll page-scroll">
        <div className="page-inner">
          <div className="lg-tile level-card">
            <div className="level-badge"><span>{lv.index + 1}</span></div>
            <div className="level-body">
              <small className="lg-label">Your rank</small>
              <h2>{lv.name}</h2>
              <div className="xp-bar"><i style={{ transform: `scaleX(${lv.progress})` }} /></div>
              <p className="lg-text-2">{lv.next ? `${lv.toNext} XP to ${lv.next}` : 'Maximum rank. Legendary.'} · {unlocked}/{ACHIEVEMENTS.length} achievements · {Object.keys(done).length}/{LESSONS.length} lessons</p>
            </div>
            <div className="level-ladder">{LEVELS.map((l, i) => <span key={l.name} className={i <= lv.index ? 'is-on' : ''}>{l.name}</span>)}</div>
          </div>

          <h3 className="section-title">Driving school</h3>
          <div className="lesson-list">
            {LESSONS.map((l, i) => {
              const isDone = !!done[l.id]; const active = a.lesson === l.id; const isNext = nextLesson?.id === l.id;
              return (
                <div key={l.id} className={`lg-tile lesson${isDone ? ' is-done' : ''}${active ? ' is-active' : ''}`}>
                  <span className="lesson-n">{isDone ? <Icon name="check" size={16} /> : i + 1}</span>
                  <div className="lesson-body"><b>{l.title}</b><p className="lg-text-2">{l.goal}</p><small className="lg-text-3">{l.tip}</small></div>
                  <span className="lesson-xp">+{l.xp}</span>
                  <button className={`lg-btn${isNext && !active ? ' is-primary' : ''}`} onClick={() => onLesson(l.id)}>{active ? 'In progress' : isDone ? 'Replay' : 'Start'}</button>
                </div>
              );
            })}
          </div>

          <h3 className="section-title">Achievements · {unlocked}/{ACHIEVEMENTS.length}</h3>
          <div className="ach-grid">
            {ACHIEVEMENTS.map((x) => {
              const got = a.unlocked[x.id];
              return (
                <div key={x.id} className={`lg-tile ach${got ? ' is-got' : ''}`}>
                  <span className="ach-icon">{got ? x.icon : '🔒'}</span>
                  <b>{x.title}</b><small>{x.desc}</small>
                  <span className="ach-xp">{got ? new Date(got).toLocaleDateString([], { day: 'numeric', month: 'short' }) : `+${x.xp} XP`}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
