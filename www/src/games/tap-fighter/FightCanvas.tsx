import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import blueSprite from './art/fighter1.png?url&no-inline';
import greenSprite from './art/fighter2.png?url&no-inline';
import { FIGHTER_SPRITE_MIRRORED, FIGHTER_WINDUP_MS } from './game';

type Props = {
  bluePose: number;
  greenPose: number;
  blueAttacking: boolean;
  greenAttacking: boolean;
  beatTime: number;
};

const FRAME = 256;
const COLUMNS = 4;

export function FightCanvas(props: Props): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const blue = new Image();
    const green = new Image();
    blue.src = blueSprite;
    green.src = greenSprite;
    let frame = 0;

    const draw = (): void => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width === 0 || height === 0) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (element.width !== pixelWidth || element.height !== pixelHeight) {
        element.width = pixelWidth;
        element.height = pixelHeight;
      }
      const context = element.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!blue.complete || !green.complete) {
        frame = requestAnimationFrame(draw);
        return;
      }

      const state = latest.current;
      const spriteSize = Math.min(width * 0.3, 176);
      const idleGap = width * 0.54;
      const leftIdle = (width - idleGap) / 2;
      const rightIdle = (width + idleGap) / 2;
      const minimumSeparation = spriteSize * 0.95;
      // `attacking` only ever turns true once the idle wind-up (`FIGHTER_WINDUP_MS`,
      // `TapFighterRoom.tsx`) has already played, so the ramp-in starts there —
      // the hold-until-1500 and the decay after it stay anchored to the beat's own
      // absolute time, unaffected by the wind-up.
      const attackProgress = (attacking: boolean): number => {
        if (!attacking) return 0;
        if (state.beatTime < FIGHTER_WINDUP_MS + 180) return (state.beatTime - FIGHTER_WINDUP_MS) / 180;
        if (state.beatTime < 1_500) return 1;
        return Math.max(0, 1 - (state.beatTime - 1_500) / 250);
      };
      const blueLunge = attackProgress(state.blueAttacking);
      const greenLunge = attackProgress(state.greenAttacking);
      const blueTarget = rightIdle - minimumSeparation;
      const greenTarget = leftIdle + minimumSeparation;
      let blueX = leftIdle + (blueTarget - leftIdle) * blueLunge;
      let greenX = rightIdle + (greenTarget - rightIdle) * greenLunge;
      if (greenX - blueX < minimumSeparation) {
        const middle = (blueX + greenX) / 2;
        blueX = middle - minimumSeparation / 2;
        greenX = middle + minimumSeparation / 2;
      }

      const drawFighter = (image: HTMLImageElement, x: number, pose: number, mirrored: boolean): void => {
        context.save();
        context.translate(x, height * 0.74 - spriteSize);
        context.imageSmoothingEnabled = false;
        const column = pose % COLUMNS;
        const sourceX = (mirrored ? COLUMNS - 1 - column : column) * FRAME;
        const sourceY = Math.floor(pose / COLUMNS) * FRAME;
        context.drawImage(image, sourceX, sourceY, FRAME, FRAME, -spriteSize / 2, 0, spriteSize, spriteSize);
        context.restore();
      };
      drawFighter(blue, blueX, state.bluePose, FIGHTER_SPRITE_MIRRORED.blue);
      drawFighter(green, greenX, state.greenPose, FIGHTER_SPRITE_MIRRORED.green);
      frame = requestAnimationFrame(draw);
    };

    const resize = new ResizeObserver(() => { /* the draw loop reads the new CSS size */ });
    resize.observe(element);
    blue.addEventListener('load', draw, { once: true });
    green.addEventListener('load', draw, { once: true });
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, []);

  return <canvas ref={canvas} class="fighter-canvas" aria-hidden="true" />;
}
