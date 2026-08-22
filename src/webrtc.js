import {
  writeOffer,
  subscribeAnswer,
  pushIceCandidate,
  subscribeIceCandidates,
  writeAnswer,
  subscribeOffer,
} from "./firebase";

// Public STUN server only — no TURN server configured. This means video
// will connect on most home/mobile networks, but can fail to connect on
// strict corporate firewalls or some carrier-grade NATs. Best-effort only.
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// Runs on the SOS-triggering device once a viewer announces itself.
// Sends this device's camera stream to that one viewer.
export function createBroadcasterConnection(broadcasterId, viewerId, localStream) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) pushIceCandidate(broadcasterId, "broadcaster", viewerId, e.candidate);
  };

  const unsubAnswer = subscribeAnswer(broadcasterId, viewerId, async (answer) => {
    try {
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (err) {
      console.warn("WebRTC: failed to apply answer", err);
    }
  });

  const unsubIce = subscribeIceCandidates(broadcasterId, "viewer", viewerId, (candidate) => {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  });

  (async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      writeOffer(broadcasterId, viewerId, { type: offer.type, sdp: offer.sdp });
    } catch (err) {
      console.warn("WebRTC: failed to create offer", err);
    }
  })();

  return () => {
    unsubAnswer();
    unsubIce();
    pc.close();
  };
}

// Runs on a family member's device (in the "Family" tab) to watch a
// specific active user's camera. Calls onRemoteStream once video arrives.
export function createViewerConnection(broadcasterId, viewerId, onRemoteStream) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const remoteStream = new MediaStream();

  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
    onRemoteStream(remoteStream);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) pushIceCandidate(broadcasterId, "viewer", viewerId, e.candidate);
  };

  const unsubOffer = subscribeOffer(broadcasterId, viewerId, async (offer) => {
    try {
      if (pc.signalingState !== "stable") return;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      writeAnswer(broadcasterId, viewerId, { type: answer.type, sdp: answer.sdp });
    } catch (err) {
      console.warn("WebRTC: failed to answer offer", err);
    }
  });

  const unsubIce = subscribeIceCandidates(broadcasterId, "broadcaster", viewerId, (candidate) => {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  });

  return () => {
    unsubOffer();
    unsubIce();
    pc.close();
  };
}
