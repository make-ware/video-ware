'use client';

import React from 'react';
import {
  VideoPlayerUI,
  type VideoPlayerUIProps,
} from '../video/video-player-ui';

export function MediaPlayer(props: VideoPlayerUIProps) {
  return <VideoPlayerUI {...props} />;
}
