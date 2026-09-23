// Pure camera: world<->screen transform, zoom-around-point, clamps.
// Models the MainView camera of the original (Controls/MainView.cs,
// Main.Part11.cs): `zoom` is pixels per world unit, so zoom === 1 is the
// original's 100% ("actualZoomFactor === 1.0") and smaller zoom means
// more zoomed out (actualZoomFactor = 1/zoom). minZoom is set from the
// galaxy physical dimensions (Galaxy.sizeX/sizeY) so the whole galaxy fits
// on screen with a small margin, like the original's most-zoomed-out state.

export class Camera {
    /** World-space point at the screen center. */
    x = 0;
    y = 0;
    /** Pixels per world unit (1 = 100%). */
    zoom = 1;
    width = 1600;
    height = 900;
    minZoom = 1e-6;
    maxZoom = 1;

    setViewport(width: number, height: number): void {
        this.width = width;
        this.height = height;
    }

    // Port of the original's galaxy-bounds zoom clamp: the most zoomed-out
    // level shows the entire galaxy (MainView.1.cs PrepareGalaxyBackdrop
    // sizes the backdrop to Galaxy.sizeX/sizeY).
    setGalaxyBounds(galaxyWidth: number, galaxyHeight: number): void {
        const fit = Math.min(this.width / galaxyWidth, this.height / galaxyHeight);
        this.minZoom = fit * 0.9; // small margin of black around the galaxy
    }

    clampZoom(zoom: number): number {
        return Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    }

    screenToWorld(sx: number, sy: number): { x: number; y: number } {
        return {
            x: this.x + (sx - this.width / 2) / this.zoom,
            y: this.y + (sy - this.height / 2) / this.zoom,
        };
    }

    worldToScreen(wx: number, wy: number): { x: number; y: number } {
        return {
            x: (wx - this.x) * this.zoom + this.width / 2,
            y: (wy - this.y) * this.zoom + this.height / 2,
        };
    }

    // Port of the original's wheel-zoom behavior (Main.Part11.cs): zoom
    // around the cursor so the world point under the cursor stays fixed.
    zoomAt(newZoom: number, sx: number, sy: number): void {
        const before = this.screenToWorld(sx, sy);
        this.zoom = this.clampZoom(newZoom);
        // Re-center so the point under the cursor is unchanged at the
        // (possibly clamped) zoom level.
        const after = this.screenToWorld(sx, sy);
        this.x += before.x - after.x;
        this.y += before.y - after.y;
    }

    /** Pan by a screen-pixel delta (right-drag). */
    panByScreen(dx: number, dy: number): void {
        this.x -= dx / this.zoom;
        this.y -= dy / this.zoom;
    }

    /** Center the view on a world point (right-click / edge scroll target). */
    centerOn(wx: number, wy: number): void {
        this.x = wx;
        this.y = wy;
    }

    // Port of the original's PageUp/PageDown zoom steps (Main.Part11.cs):
    // discrete steps on the zoom factor. dir > 0 zooms in (towards 100%),
    // dir < 0 zooms out (towards the galaxy view).
    zoomStep(dir: number): void {
        // Geometric steps: 100% -> ~33% -> ~11% -> ... matching the
        // original's roughly-tripling zoom factors per page step.
        const factor = Math.pow(3, dir);
        this.zoomAt(this.zoom * factor, this.width / 2, this.height / 2);
    }
}