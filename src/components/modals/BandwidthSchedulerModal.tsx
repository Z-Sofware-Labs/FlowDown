import React, { useState } from 'react';
import { Calendar, Clock, Gauge, Save } from 'lucide-react';
import { BandwidthLimits } from '../../types';
import { SubwindowHeader } from './SubwindowHeader';

interface BandwidthSchedulerModalProps {
  isOpen: boolean;
  onClose: () => void;
  limits: BandwidthLimits;
  onSave: (newLimits: Partial<BandwidthLimits>) => void;
}

export const BandwidthSchedulerModal: React.FC<BandwidthSchedulerModalProps> = ({
  isOpen,
  onClose,
  limits,
  onSave,
}) => {
  const [enabled, setEnabled] = useState(limits.scheduledAltSpeed);
  const [startHour, setStartHour] = useState(limits.scheduleStartHour);
  const [endHour, setEndHour] = useState(limits.scheduleEndHour);
  const [altDown, setAltDown] = useState(limits.altDownloadLimit);
  const [altUp, setAltUp] = useState(limits.altUploadLimit);

  React.useEffect(() => {
    if (isOpen) {
      setEnabled(limits.scheduledAltSpeed);
      setStartHour(limits.scheduleStartHour);
      setEndHour(limits.scheduleEndHour);
      setAltDown(limits.altDownloadLimit);
      setAltUp(limits.altUploadLimit);
    }
  }, [isOpen, limits]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave({
      scheduledAltSpeed: enabled,
      scheduleStartHour: startHour,
      scheduleEndHour: endHour,
      altDownloadLimit: altDown,
      altUploadLimit: altUp,
    });
    onClose();
  };

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const isHourInWindow = (h: number) =>
    startHour <= endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="w-full max-w-xl bg-[var(--os-bg-window)] border border-[var(--os-border)] rounded shadow-2xl overflow-hidden text-[var(--os-text)] text-xs font-sans">
        <SubwindowHeader
          onClose={onClose}
          icon={<Calendar className="w-4 h-4 text-[var(--os-accent)] shrink-0" />}
          title="Bandwidth Scheduler & Alternative Speed Limits"
        />

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between p-3 rounded bg-[var(--os-bg-alt)] border border-[var(--os-border)]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded accent-[var(--os-accent)]"
              />
              <div>
                <span className="font-semibold text-[var(--os-text)] text-xs block">
                  Enable Scheduled Bandwidth Throttling
                </span>
                <span className="text-[10px] text-[var(--os-text-muted)]">
                  Automatically switch to Turtle Speed limits during scheduled hours.
                </span>
              </div>
            </label>
            <Gauge className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>

          {/* Rate limits & active window hours */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded bg-[var(--os-bg-alt)] border border-[var(--os-border)] font-mono text-[11px]">
            <div>
              <label className="text-[var(--os-text-muted)] block mb-1">Turtle Down (KB/s):</label>
              <input
                type="number"
                step="256"
                min="128"
                value={altDown}
                onChange={(e) => setAltDown(parseInt(e.target.value) || 1024)}
                className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-emerald-700 dark:text-emerald-400 font-bold focus:outline-none focus:border-[var(--os-accent)]"
              />
            </div>
            <div>
              <label className="text-[var(--os-text-muted)] block mb-1">Turtle Up (KB/s):</label>
              <input
                type="number"
                step="128"
                min="64"
                value={altUp}
                onChange={(e) => setAltUp(parseInt(e.target.value) || 256)}
                className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-accent)] font-bold focus:outline-none focus:border-[var(--os-accent)]"
              />
            </div>
            <div>
              <label className="text-[var(--os-text-muted)] flex items-center gap-1 mb-1">
                <Clock className="w-3 h-3" />
                <span>Start Hour:</span>
              </label>
              <select
                value={startHour}
                onChange={(e) => setStartHour(parseInt(e.target.value, 10))}
                className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] font-bold focus:outline-none focus:border-[var(--os-accent)]"
              >
                {hours.map((h) => (
                  <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[var(--os-text-muted)] flex items-center gap-1 mb-1">
                <Clock className="w-3 h-3" />
                <span>End Hour:</span>
              </label>
              <select
                value={endHour}
                onChange={(e) => setEndHour(parseInt(e.target.value, 10))}
                className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] font-bold focus:outline-none focus:border-[var(--os-accent)]"
              >
                {hours.map((h) => (
                  <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Schedule Grid Preview */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[var(--os-text-muted)]">
              <span>Active Weekly Schedule Grid:</span>
              <span className="font-mono text-amber-700 dark:text-amber-300 font-bold">
                {String(startHour).padStart(2, '0')}:00 - {String(endHour).padStart(2, '0')}:00 (Every Weekday)
              </span>
            </div>
            <div className="p-2 bg-[var(--os-bg-content)] rounded border border-[var(--os-border)] space-y-1 overflow-x-auto">
              <div className="flex gap-1 text-[9px] font-mono text-[var(--os-text-muted)] ml-8">
                <span>00</span>
                <span className="ml-6">06</span>
                <span className="ml-6">12</span>
                <span className="ml-6">18</span>
                <span className="ml-6">23</span>
              </div>
              {days.map((day, dIdx) => (
                <div key={day} className="flex items-center gap-1.5 text-[10px] font-mono">
                  <span className="w-6 text-[var(--os-text-muted)] text-right">{day}</span>
                  <div className="flex-1 flex gap-[2px]">
                    {hours.map((h) => {
                      const isWeekday = dIdx < 5;
                      const isThrottled = enabled && isWeekday && isHourInWindow(h);
                      return (
                        <div
                          key={h}
                          title={`${day} ${h}:00 - ${isThrottled ? 'Turtle Mode (Restricted)' : 'Full Speed Line Rate'}`}
                          className={`flex-1 h-3.5 rounded-[1px] transition-colors ${
                            isThrottled
                              ? 'bg-amber-500'
                              : 'bg-emerald-600/30 dark:bg-emerald-600/40 hover:bg-emerald-500/60'
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-[var(--os-text-muted)] pt-1">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-emerald-600/40 rounded-xs" /> Full Speed (Night & Weekends)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-amber-500 rounded-xs" /> Turtle Throttled (Work hours)
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--os-border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-1.5 rounded bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white text-xs font-semibold shadow-2xs flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Schedule</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
