// Multi-select model for the DataGridView-based lists of the original (BuiltObjectListView: Grid.SelectedRows with
// MultiSelect on): a plain click selects one row, Ctrl+click toggles a row, Shift+click selects the range from the
// anchor (the last plain/Ctrl-clicked row), Ctrl+A selects all. Pure, so it is unit-tested without a DOM.

export interface ClickModifiers {
    ctrl?: boolean;
    shift?: boolean;
}

export class ListSelection<T> {
    private items: readonly T[] = [];
    private chosen = new Set<T>();
    private anchor = -1;

    /** Replace the rows the selection ranges over (a filter change / refresh); selected items that are gone drop out. */
    setItems(items: readonly T[]): void {
        this.items = items;
        const present = new Set(items);
        for (const s of [...this.chosen]) if (!present.has(s)) this.chosen.delete(s);
        if (this.anchor >= items.length) this.anchor = items.length - 1;
    }

    /** A click on row `index` with the modifier keys held (Windows.Forms grid semantics). */
    click(index: number, mods: ClickModifiers = {}): void {
        if (index < 0 || index >= this.items.length) return;
        const item = this.items[index];
        if (mods.shift && this.anchor >= 0) {
            const [a, b] = this.anchor <= index ? [this.anchor, index] : [index, this.anchor];
            if (!mods.ctrl) this.chosen.clear();
            for (let i = a; i <= b; i++) this.chosen.add(this.items[i]);
            return; // the anchor stays
        }
        if (mods.ctrl) {
            if (this.chosen.has(item)) this.chosen.delete(item);
            else this.chosen.add(item);
        } else {
            this.chosen.clear();
            this.chosen.add(item);
        }
        this.anchor = index;
    }

    selectAll(): void {
        this.chosen = new Set(this.items);
    }

    clear(): void {
        this.chosen.clear();
        this.anchor = -1;
    }

    /** Programmatic single selection (e.g. the currently selected ship when the list opens). */
    select(item: T): void {
        const i = this.items.indexOf(item);
        if (i < 0) return;
        this.chosen = new Set([item]);
        this.anchor = i;
    }

    isSelected(item: T): boolean {
        return this.chosen.has(item);
    }

    /** The selected items in list order. */
    selected(): T[] {
        return this.items.filter((i) => this.chosen.has(i));
    }

    /** The first selected item in list order (DataGridView SelectedRows[0] / SelectedBuiltObject), or null. */
    first(): T | null {
        return this.items.find((i) => this.chosen.has(i)) ?? null;
    }

    get count(): number {
        return this.chosen.size;
    }
}
