import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PresentationResourceEmitter } from '../presentation-model.js';

describe('Humanize with qualified ids', () =>
{
    test('humanizes only the last segment', () =>
    {
        assert.equal(PresentationResourceEmitter.Humanize('ea.MS.azure'), 'Azure');
        assert.equal(PresentationResourceEmitter.Humanize('ea.Location'), 'Location');
        assert.equal(PresentationResourceEmitter.Humanize('app-component'), 'App Component');
    });
});
