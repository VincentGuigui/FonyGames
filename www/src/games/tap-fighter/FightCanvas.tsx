import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import blueSprite from './art/fighter-1.svg?url&no-inline';
import greenSprite from './art/fighter-2.svg?url&no-inline';

type Props = {
  bluePose: number;
  greenPose: number;
  blueAttacking: boolean;
  greenAttacking: boolean;
  beatTime: number;
};

const FRAME = 80;

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
      const attackProgress = (attacking: boolean): number => {
        if (!attacking) return 0;
        if (state.beatTime < 180) return state.beatTime / 180;
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

      const drawFighter = (image: HTMLImageElement, x: number, pose: number, mirror: boolean): void => {
        context.save();
        context.translate(x, height * 0.74 - spriteSize);
        if (mirror) context.scale(-1, 1);
        context.imageSmoothingEnabled = false;
        context.drawImage(image, pose * FRAME, 0, FRAME, FRAME, -spriteSize / 2, 0, spriteSize, spriteSize);
        context.restore();
      };
      drawFighter(blue, blueX, state.bluePose, false);
      drawFighter(green, greenX, state.greenPose, true);
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
