import confetti from 'canvas-confetti';

export function celebrateGoal() {
  const defaults = {
    spread: 70,
    ticks: 120,
    gravity: 0.9,
    decay: 0.92,
    startVelocity: 32,
    colors: ['#FFB800', '#34D399', '#A78BFA', '#FFFFFF'],
  };

  void confetti({
    ...defaults,
    particleCount: 80,
    origin: { y: 0.65 },
  });

  window.setTimeout(() => {
    void confetti({
      ...defaults,
      particleCount: 50,
      angle: 60,
      origin: { x: 0, y: 0.7 },
    });
    void confetti({
      ...defaults,
      particleCount: 50,
      angle: 120,
      origin: { x: 1, y: 0.7 },
    });
  }, 180);
}
