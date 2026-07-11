/**
 * Shared class list for the 16:9 media preview frame used across the clip
 * preview modals (editor, details, fine-tune). Keeping it in one place ensures
 * every preview modal stays visually consistent.
 *
 * The frame is height-led: `max-w-[calc(Nvh*16/9)]` caps the width to the width
 * a 16:9 box would have at N vh tall, so `aspect-video` resolves the height to
 * <= N vh no matter how wide the (now full-screen, 95vw) modal is — this is what
 * keeps the preview from overflowing the viewport. `w-full` keeps it responsive
 * on narrow/tall viewports and `mx-auto` centers it.
 */
export const MEDIA_PREVIEW_FRAME =
  'aspect-video bg-black rounded-lg overflow-hidden relative border shadow-sm mx-auto w-full max-h-[40vh] max-w-[calc(40vh*16/9)] lg:max-h-[62vh] lg:max-w-[calc(62vh*16/9)]';
