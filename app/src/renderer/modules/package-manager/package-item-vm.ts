import { Observable } from "@pragmatic-tech-ai/mural/runtime";

// One row in the Package Manager listbox — a package by name. A lightweight
// Observable so each row renders through DataTemplate[PackageItemVM] rather than
// a raw string, and the natural seam for adding version/description later.
export class PackageItemVM extends Observable {
  constructor(private readonly _name: string) {
    super();
  }

  get Name(): string {
    return this._name;
  }
}
