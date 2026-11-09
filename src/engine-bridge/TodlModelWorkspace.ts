import type { ModelDraft } from '../authoring/model-draft.js';

/**
 * Where the TODL file connector finds the editable sources of a model (the seam a host implements over its
 * storage). `model` is the engine Owner of the written nodes: the HOME package model id of an instance.
 */
export interface ITodlModelWorkspace
{
    /** A fresh draft session over the model's sources; undefined when the model has no editable sources here. */
    OpenDraft(model: string): Promise<ITodlDraftSession | undefined>;
}

/** One model's sources opened as a draft, with the file operations a commit needs. Uris are workspace-relative. */
export interface ITodlDraftSession
{
    /** The draft over the model's sources as they were when the session opened. */
    readonly Draft: ModelDraft;
    /** The model's namespace: its instance ids are `${Namespace}.${localId}`. */
    readonly Namespace: string;
    /** Hash of the model's sources when the session opened. */
    readonly SourceHash: string;
    /**
     * Hash of the model's sources now (equal to SourceHash while nothing else has written them). The connector checks
     * it after reading the files it will replace and before writing them, holding its own per-model lock, so writes
     * through the same connector never race it. A writer OUTSIDE the connector that lands between this check and the
     * connector's writes is not detected (a plain compare-and-swap window, as in the dev model writer); a workspace
     * whose storage can be written by others should serialize those writes with the connector's.
     */
    CurrentSourceHash(): Promise<string>;
    /** The file's text, or undefined when it does not exist. */
    ReadFile(uri: string): Promise<string | undefined>;
    /** Creates or replaces the file; a file written for the model becomes one of its sources (and enters its hash). */
    WriteFile(uri: string, text: string): Promise<void>;
    /**
     * Deletes the file (used to compensate a file a commit created). A deleted file leaves the model's sources, so it
     * no longer enters CurrentSourceHash: the hash after the delete equals the hash before the file was created.
     */
    DeleteFile(uri: string): Promise<void>;
}
