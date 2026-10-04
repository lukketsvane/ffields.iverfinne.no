"use client";

import {useEffect, useRef, useState} from 'react';
import {keyboardObstruction} from '@/lib/mobile-viewport';

function focusedEditor() {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return null;
  if (element.isContentEditable) return element;
  if (element instanceof HTMLTextAreaElement) return element.disabled || element.readOnly ? null : element;
  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) return null;
  return /^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/.test(element.type) ? null : element;
}

function revealEditor(workspace: HTMLElement) {
  const element = focusedEditor();
  if (!element || !workspace.contains(element)) return;
  // Only scroll the editor's own container; scrolling ancestors can pan Safari's page.
  for (let parent = element.parentElement; parent && parent !== workspace; parent = parent.parentElement) {
    if (!/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
    const box = parent.getBoundingClientRect(), input = element.getBoundingClientRect();
    const top = box.top + parent.clientTop + 8, bottom = box.top + parent.clientTop + parent.clientHeight - 8;
    if (input.top < top) parent.scrollTop += input.top - top;
    else if (input.bottom > bottom) parent.scrollTop += input.bottom - bottom;
    return;
  }
}

export function useWorkspaceViewport() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const workspace = ref.current;
    if (!workspace) return;
    const visual = window.visualViewport;
    const mobile = matchMedia('(max-width:760px), (max-width:960px) and (max-height:520px) and (pointer:coarse)');
    let updateFrame = 0, revealFrame = 0;
    const update = () => {
      updateFrame = 0;
      const height = workspace.clientHeight;
      setHeight(height);
      setKeyboardInset(visual ? keyboardObstruction({
        appHeight: height, visualHeight: visual.height, offsetTop: visual.offsetTop,
        scale: visual.scale, mobile: mobile.matches, editing: !!focusedEditor(),
      }) : 0);
      cancelAnimationFrame(revealFrame);
      revealFrame = requestAnimationFrame(() => {
        revealFrame = 0;
        if (mobile.matches) revealEditor(workspace);
      });
    };
    const schedule = () => {if (!updateFrame) updateFrame = requestAnimationFrame(update)};
    const observer = new ResizeObserver(schedule);
    observer.observe(workspace);
    visual?.addEventListener('resize', schedule);
    visual?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    mobile.addEventListener('change', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(updateFrame);
      cancelAnimationFrame(revealFrame);
      visual?.removeEventListener('resize', schedule);
      visual?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      mobile.removeEventListener('change', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
    };
  }, []);

  return {ref, height, keyboardInset};
}
