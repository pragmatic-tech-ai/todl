import { RelayCommand } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService, DialogAction, ButtonVariant } from "@pragmatic-tech-ai/mural/framework";
import { TextBlock, TextWrapping } from "@pragmatic-tech-ai/mural/basic";

export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

// A modal yes/no confirmation rendered by the app's Mural DialogService (an
// in-app dialog on the shell's overlay layer, not a native OS message box).
// Resolves true when the confirming action is chosen, false on cancel or a
// scrim / Escape dismissal.
export class ConfirmDialog {
  static async show(dialogs: DialogService, request: ConfirmRequest): Promise<boolean> {
    const body = new TextBlock();
    body.Text = request.message;
    body.TextWrapping = TextWrapping.Wrap;

    const result = await dialogs.Show<boolean>({
      Title: request.title,
      Content: body,
      Width: 380,
      Actions: [
        new DialogAction(request.cancelLabel ?? "Cancel", new RelayCommand(() => dialogs.Close(false))),
        new DialogAction(request.confirmLabel ?? "OK", new RelayCommand(() => dialogs.Close(true)), ButtonVariant.Filled),
      ],
    });
    return result === true;
  }
}
