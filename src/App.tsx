import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Voice = {
  context: AudioContext;
  gain: GainNode;
  oscillators: OscillatorNode[];
};

type Tuning = {
  label: string;
  short: string;
  roots: number[];
};

const TUNINGS: Record<string, Tuning> = {
  gcf: { label: "Sol · Do · Fa", short: "GCF", roots: [67, 60, 65] },
  adg: { label: "La · Re · Sol", short: "ADG", roots: [69, 62, 67] },
  bea: { label: "Si♭ · Mi♭ · La♭", short: "B♭E♭A♭", roots: [70, 63, 68] },
};

const TREBLE_KEYS = [
  "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P",
  "A", "S", "D", "F", "G", "H", "J", "K", "L", "Ñ", "Z",
  "X", "C", "V", "B", "N", "M", ",", ".", "/", ";",
];
const BASS_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
const ROW_LENGTHS = [10, 11, 10];
const SCALE = [0, 2, 4, 5, 7, 9, 11];

function midiToFrequency(note: number) {
  return 440 * 2 ** ((note - 69) / 12);
}

function noteForButton(index: number, roots: number[], opening: boolean) {
  const row = index < 10 ? 0 : index < 21 ? 1 : 2;
  const position = index - (row === 0 ? 0 : row === 1 ? 10 : 21);
  const scalePosition = position + (opening ? 1 : 0);
  return roots[row] + SCALE[scalePosition % SCALE.length] + 12 * Math.floor(scalePosition / SCALE.length);
}

function AccordionButton({
  label,
  active,
  bass = false,
  onStart,
  onEnd,
}: {
  label: string;
  active: boolean;
  bass?: boolean;
  onStart: () => void;
  onEnd: () => void;
}) {
  return (
    <button
      className={`accordion-key ${bass ? "bass-key" : "treble-key"} ${active ? "is-active" : ""}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onStart();
      }}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onPointerLeave={(event) => {
        if (event.buttons) onEnd();
      }}
      aria-label={`Tocar tecla ${label}`}
    >
      <span>{label}</span>
    </button>
  );
}

export default function App() {
  const [tuning, setTuning] = useState("gcf");
  const [opening, setOpening] = useState(false);
  const [bellows, setBellows] = useState(34);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [audioReady, setAudioReady] = useState(false);
  const voices = useRef(new Map<string, Voice>());
  const audioContext = useRef<AudioContext | null>(null);
  const openingRef = useRef(opening);
  const tuningRef = useRef(tuning);

  useEffect(() => {
    openingRef.current = opening;
  }, [opening]);

  useEffect(() => {
    tuningRef.current = tuning;
  }, [tuning]);

  useEffect(() => {
    let frame = 0;
    const move = () => {
      setBellows((current) => {
        const target = openingRef.current ? 94 : 34;
        return Math.abs(target - current) < 0.3 ? target : current + (target - current) * 0.075;
      });
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, []);

  const ensureAudio = useCallback(() => {
    if (!audioContext.current) {
      audioContext.current = new AudioContext();
    }
    if (audioContext.current.state === "suspended") {
      void audioContext.current.resume();
    }
    setAudioReady(true);
    return audioContext.current;
  }, []);

  const stopVoice = useCallback((id: string) => {
    const voice = voices.current.get(id);
    if (!voice) return;
    const now = voice.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0.0001, now, 0.06);
    voice.oscillators.forEach((oscillator) => oscillator.stop(now + 0.35));
    voices.current.delete(id);
    setActiveKeys((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const playVoice = useCallback(
    (id: string, frequency: number, bass = false) => {
      if (voices.current.has(id)) return;
      const context = ensureAudio();
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      const now = context.currentTime;
      const frequencies = bass ? [-7, 0, 7] : [-11, 0, 9];

      filter.type = "lowpass";
      filter.frequency.value = bass ? 900 : 3800;
      filter.Q.value = 1.2;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(bass ? 0.16 : 0.11, now + 0.025);
      gain.connect(filter);
      filter.connect(context.destination);

      const oscillators = frequencies.map((detune, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = index === 1 ? "sawtooth" : "square";
        oscillator.frequency.value = frequency * (bass && index === 0 ? 0.5 : 1);
        oscillator.detune.value = detune;
        oscillator.connect(gain);
        oscillator.start();
        return oscillator;
      });
      voices.current.set(id, { context, gain, oscillators });
      setActiveKeys((current) => new Set(current).add(id));
    },
    [ensureAudio],
  );

  const playTreble = useCallback(
    (index: number) => {
      const id = `t-${index}`;
      const selected = TUNINGS[tuningRef.current];
      const midi = noteForButton(index, selected.roots, openingRef.current);
      playVoice(id, midiToFrequency(midi));
    },
    [playVoice],
  );

  const testSound = useCallback(() => {
    stopVoice("audio-test");
    playVoice("audio-test", midiToFrequency(TUNINGS[tuningRef.current].roots[0]));
    window.setTimeout(() => stopVoice("audio-test"), 550);
  }, [playVoice, stopVoice]);

  const playBass = useCallback(
    (index: number) => {
      const id = `b-${index}`;
      const root = TUNINGS[tuningRef.current].roots[index % 3] - 24;
      const interval = index % 2 === 0 ? 0 : openingRef.current ? 7 : 4;
      playVoice(id, midiToFrequency(root + interval), true);
    },
    [playVoice],
  );

  useEffect(() => {
    const trebleLookup = new Map(TREBLE_KEYS.map((key, index) => [key.toLowerCase(), index]));
    const bassLookup = new Map(BASS_KEYS.map((key, index) => [key, index]));

    const down = (event: KeyboardEvent) => {
      if (event.repeat || event.target instanceof HTMLSelectElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        setOpening(true);
        return;
      }
      const trebleIndex = trebleLookup.get(event.key.toLowerCase());
      const bassIndex = bassLookup.get(event.key);
      if (trebleIndex !== undefined) playTreble(trebleIndex);
      if (bassIndex !== undefined) playBass(bassIndex);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setOpening(false);
        return;
      }
      const trebleIndex = trebleLookup.get(event.key.toLowerCase());
      const bassIndex = bassLookup.get(event.key);
      if (trebleIndex !== undefined) stopVoice(`t-${trebleIndex}`);
      if (bassIndex !== undefined) stopVoice(`b-${bassIndex}`);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [playBass, playTreble, stopVoice]);

  useEffect(() => () => {
    voices.current.forEach((_, id) => stopVoice(id));
    void audioContext.current?.close();
  }, [stopVoice]);

  const rows = useMemo(() => {
    let cursor = 0;
    return ROW_LENGTHS.map((length) => {
      const row = TREBLE_KEYS.slice(cursor, cursor + length);
      cursor += length;
      return row;
    });
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span>C</span><i>III</i></div>
          <div>
            <p className="eyebrow">Instrumento digital</p>
            <h1>Hohner Corona III · Vallenato</h1>
          </div>
        </div>
        <div className="controls">
          <label className="tuning-control">
            <span>Tonalidad</span>
            <select value={tuning} onChange={(event) => setTuning(event.target.value)}>
              {Object.entries(TUNINGS).map(([value, item]) => (
                <option key={value} value={value}>{item.label}</option>
              ))}
            </select>
          </label>
          <button
            className={`sound-status ${audioReady ? "ready" : ""}`}
            onClick={testSound}
            type="button"
            aria-label="Activar y probar sonido"
          >
            <i />
            {audioReady ? "Probar sonido" : "Activar sonido"}
          </button>
        </div>
      </header>

      <section className="stage" aria-label="Acordeón vallenato virtual">
        <div className="instrument-specs" aria-hidden="true">
          <span><b>31</b> pitos</span>
          <i />
          <span><b>12</b> bajos</span>
          <i />
          <span><b>3</b> hileras</span>
        </div>
        <div className="instrument-shadow" />
        <div className="accordion" style={{ "--bellows": `${bellows}px` } as React.CSSProperties}>
          <section className="accordion-side bass-side">
            <div className="leather-strap left-strap" />
            <div className="case-face bass-face">
              <div className="grille-pattern" />
              <div className="bass-keyboard">
                <div className="bass-grid">
                  {BASS_KEYS.map((key, index) => (
                    <AccordionButton
                      key={key}
                      label={key}
                      bass
                      active={activeKeys.has(`b-${index}`)}
                      onStart={() => playBass(index)}
                      onEnd={() => stopVoice(`b-${index}`)}
                    />
                  ))}
                </div>
              </div>
              <div className="mini-badge">{TUNINGS[tuning].short}</div>
            </div>
          </section>

          <div className="bellows" aria-hidden="true">
            <div className="bellows-folds">
              {Array.from({ length: 13 }, (_, index) => <i key={index} />)}
            </div>
            <div className="bellows-top" />
            <div className="bellows-bottom" />
          </div>

          <section className="accordion-side treble-side">
            <div className="leather-strap right-strap" />
            <div className="case-face treble-face">
              <div className="crown-lines" />
              <div className="treble-grille">
                <div className="brand-vertical">HOHNER</div>
                <div className="grille-mesh" />
                <div className="model-name">
                  <strong>CORONA</strong>
                  <span>III</span>
                </div>
              </div>
              <div className="treble-keyboard">
                <div className="treble-grid">
                  {rows.map((row, rowIndex) => (
                    <div className="treble-row" key={rowIndex}>
                      {row.map((key, position) => {
                        const index = rowIndex === 0 ? position : rowIndex === 1 ? 10 + position : 21 + position;
                        return (
                          <AccordionButton
                            key={`${key}-${index}`}
                            label={key}
                            active={activeKeys.has(`t-${index}`)}
                            onStart={() => playTreble(index)}
                            onEnd={() => stopVoice(`t-${index}`)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <footer className="play-guide">
        <div className="guide-copy">
          <p className="eyebrow">Cómo tocar</p>
          <h2>Siente el aire, marca el paseo.</h2>
        </div>
        <div className="guide-actions">
          <button
            className={`bellows-control ${opening ? "pressed" : ""}`}
            onPointerDown={() => {
              ensureAudio();
              setOpening(true);
            }}
            onPointerUp={() => setOpening(false)}
            onPointerLeave={() => setOpening(false)}
            onPointerCancel={() => setOpening(false)}
          >
            <kbd>ESPACIO</kbd>
            <span>{opening ? "Abriendo fuelle" : "Mantén para abrir"}</span>
          </button>
          <div className="keyboard-tip">
            <span><b>Q — ;</b> Pitos</span>
            <span><b>1 — =</b> Bajos</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
