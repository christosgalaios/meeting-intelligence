import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadDropzone } from '../components/UploadDropzone';

afterEach(() => vi.unstubAllGlobals());

describe('UploadDropzone', () => {
  it('shows the API validation message when a transcript is rejected', async () => {
    const message = "Only 3 of 120 lines look like '[hh:mm:ss] Speaker: text'. Check the file is a transcript with one turn per line.";
    const body = { error: { code: 'VALIDATION', message, requestId: 'r1' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 422 })));
    const onUploaded = vi.fn();
    render(<MemoryRouter><UploadDropzone onUploaded={onUploaded} /></MemoryRouter>);
    const file = new File(['[00:01] A: hi\njunk'], 'notes.txt', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Transcript file'), file);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('notes.txt could not be imported');
    expect(alert).toHaveTextContent(message);
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
