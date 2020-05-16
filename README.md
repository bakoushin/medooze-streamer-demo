# Demo: recording audio/video streams from WebRTC using Medooze Media Server and GStreamer

This demo shows how to record WebRTC video stream from the browser into an `MP4` file on the server using [Medooze Media Server](https://github.com/medooze/media-server-node) and [GStreamer](https://gstreamer.freedesktop.org/).

Here is an overview of what is happening:

```
Client Webcam => Browser => Medooze Media Server => GStreamer => .mp4
```

We are leveraging Medooze [Streamer](https://medooze.github.io/media-server-node/#streamer) component in order to send RTP streams for external processing.

## Install and run

1. Clone this repo and `cd` into project directory.

2. Install dependencies and start the server:

```
npm install
npm start
```

3. Open https://127.0.0.1:3000 in the browser.

## Recording video

1. Press `Record` button for start recording.
2. Press `Stop` button for stop recording.

A new file `<TIMESTAMP>.mp4` will be created in the project directory.

## GStreamer pipeline

In order to mux audio and video streams from WebRTC into a `MP4` file, this demo uses GStreamer.

Here is a quick explanation of GStreamer pipeline used in demo:

```
# Start GStreamer
gst-launch-1.0

# Gracefully save recording when GStreamer is shut down
--eos-on-shutdown

# Mux all streams into video.mp4 file
mp4mux faststart=true name=mux ! filesink location=video.mp4

# Listen to 127.0.0.1:5004 with payload 109 (audio)
udpsrc address=127.0.0.1 port=5004 caps="application/x-rtp,clock-rate=48000,payload=109" name=audio

# Get Opus audio from RTP and decode it to AAC
audio. ! queue ! rtpjitterbuffer ! rtpopusdepay ! opusdec ! audioconvert ! audioresample ! avenc_aac ! aacparse ! mux.

# Listen to 127.0.0.1:5006 with payload 96 (video)
udpsrc address=127.0.0.1 port=5006 caps="application/x-rtp,clock-rate=90000,payload=96" name=video

# Get H264 video from RTP
video. ! queue ! rtpjitterbuffer ! rtph264depay ! h264parse ! mux.
```

## License

MIT
