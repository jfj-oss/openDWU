// Pixi render-group isolation for display objects redrawn every frame.

import { Container } from 'pixi.js';

/**
 * Wrap a display object that is redrawn every frame (a Graphics cleared and refilled per frame) in its own Pixi render
 * group. Pixi 8 rebuilds a render group's whole instruction list whenever a batchable Graphics in it changes
 * (GraphicsPipe.validateRenderable returns true), which for the Main View meant re-walking the entire scene graph —
 * every system's star, label and rings — every frame; in its own group only that object's instructions are rebuilt.
 * Drawing is unchanged (same order, same transforms).
 */
export function inOwnRenderGroup<T extends Container>(child: T): Container {
    const group = new Container({ isRenderGroup: true });
    group.addChild(child);
    return group;
}
