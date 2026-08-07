"use client";

import { Slider } from "@base-ui/react/slider";

interface RangeSliderProps {
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  min: number;
  max: number;
  step?: number;
  /** Labels the two thumbs — a dual slider is unusable by keyboard without them. */
  minLabel: string;
  maxLabel: string;
  className?: string;
}

/**
 * Two-thumb range slider.
 *
 * Base UI's Slider takes an array value for multiple thumbs and handles the
 * thumbs crossing over, which is the fiddly part of rolling this by hand with
 * two overlaid `input[type=range]`s.
 */
export function RangeSlider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  minLabel,
  maxLabel,
  className = "",
}: RangeSliderProps) {
  return (
    <Slider.Root<readonly number[]>
      value={value}
      onValueChange={(next) => onValueChange([next[0], next[1]])}
      min={min}
      max={max}
      step={step}
      className={className}
    >
      <Slider.Control className="flex w-36 touch-none select-none items-center py-2">
        <Slider.Track className="relative h-1 w-full rounded bg-zinc-200 dark:bg-purple-950">
          <Slider.Indicator className="rounded bg-purple-800 dark:bg-[#00FF87]" />
          {[minLabel, maxLabel].map((label, i) => (
            <Slider.Thumb
              key={label}
              index={i}
              getAriaLabel={() => label}
              className="h-3.5 w-3.5 rounded-full border-2 border-purple-800 bg-white outline-none focus-visible:ring-2 focus-visible:ring-purple-500 dark:border-[#00FF87] dark:bg-[#1E0234] dark:focus-visible:ring-[#00FF87]"
            />
          ))}
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

interface ValueSliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Labels the single thumb for keyboard/screen-reader users. */
  label: string;
  className?: string;
}

/**
 * Single-thumb sibling of `RangeSlider`, for a control that is one bound
 * rather than a band — a floor or a ceiling, not a range. Same primitive
 * (`@base-ui/react/slider` supports a plain `number` value, not just an
 * array), same styling, so a page mixing both reads as one control family.
 */
export function ValueSlider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  label,
  className = "",
}: ValueSliderProps) {
  return (
    <Slider.Root<number>
      value={value}
      onValueChange={(next) => onValueChange(next)}
      min={min}
      max={max}
      step={step}
      className={className}
    >
      <Slider.Control className="flex w-36 touch-none select-none items-center py-2">
        <Slider.Track className="relative h-1 w-full rounded bg-zinc-200 dark:bg-purple-950">
          <Slider.Indicator className="rounded bg-purple-800 dark:bg-[#00FF87]" />
          <Slider.Thumb
            getAriaLabel={() => label}
            className="h-3.5 w-3.5 rounded-full border-2 border-purple-800 bg-white outline-none focus-visible:ring-2 focus-visible:ring-purple-500 dark:border-[#00FF87] dark:bg-[#1E0234] dark:focus-visible:ring-[#00FF87]"
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
