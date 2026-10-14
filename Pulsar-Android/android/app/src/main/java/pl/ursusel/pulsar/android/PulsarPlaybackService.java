package pl.ursusel.pulsar.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;

public class PulsarPlaybackService extends Service {

    public static final String ACTION_UPDATE = "pl.ursusel.pulsar.android.media.UPDATE";
    public static final String ACTION_PLAY = "pl.ursusel.pulsar.android.media.PLAY";
    public static final String ACTION_PAUSE = "pl.ursusel.pulsar.android.media.PAUSE";
    public static final String ACTION_TOGGLE = "pl.ursusel.pulsar.android.media.TOGGLE";
    public static final String ACTION_NEXT = "pl.ursusel.pulsar.android.media.NEXT";
    public static final String ACTION_PREVIOUS = "pl.ursusel.pulsar.android.media.PREVIOUS";
    public static final String ACTION_MEDIA_CONTROL = "pl.ursusel.pulsar.android.media.CONTROL_EVENT";

    public static final String EXTRA_HAS_TRACK = "hasTrack";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_DURATION = "duration";
    public static final String EXTRA_CONTROL = "control";

    private static final String CHANNEL_ID = "pulsar_media_playback";
    private static final int NOTIFICATION_ID = 7314;
    private static final long SESSION_ACTIONS = PlaybackState.ACTION_PLAY
        | PlaybackState.ACTION_PAUSE
        | PlaybackState.ACTION_PLAY_PAUSE
        | PlaybackState.ACTION_SKIP_TO_NEXT
        | PlaybackState.ACTION_SKIP_TO_PREVIOUS
        | PlaybackState.ACTION_SEEK_TO;

    // The activity asks this before it lets Capacitor pause the WebView: while a
    // track is playing the WebView must stay resumed, otherwise audio stops as
    // soon as the app goes to the background or the screen turns off.
    private static volatile boolean playingTrack = false;

    public static boolean isPlaying() {
        return playingTrack;
    }

    private NotificationManager notificationManager;
    private MediaSession mediaSession;
    private PowerManager.WakeLock playbackWakeLock;
    private boolean foreground = false;
    private boolean hasTrack = false;
    private boolean playing = false;
    private String title = "";
    private String artist = "";
    private long positionMs = 0L;
    private long durationMs = 0L;

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        createNotificationChannel();

        mediaSession = new MediaSession(this, "PulsarPlayback");
        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { handleControl("play"); }
            @Override public void onPause() { handleControl("pause"); }
            @Override public void onSkipToNext() { handleControl("next"); }
            @Override public void onSkipToPrevious() { handleControl("previous"); }
            @Override public void onSeekTo(long position) {
                positionMs = Math.max(0L, position);
                refreshSessionAndNotification();
                publishControl("seekTo", positionMs);
            }
        });
        mediaSession.setSessionActivity(createLaunchPendingIntent());

        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            playbackWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":PulsarPlayback");
            playbackWakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();

        if (ACTION_UPDATE.equals(action)) {
            hasTrack = intent.getBooleanExtra(EXTRA_HAS_TRACK, false);
            if (!hasTrack) {
                clearPlaybackAndStop();
                return START_NOT_STICKY;
            }
            title = valueOrEmpty(intent.getStringExtra(EXTRA_TITLE));
            artist = valueOrEmpty(intent.getStringExtra(EXTRA_ARTIST));
            playing = intent.getBooleanExtra(EXTRA_PLAYING, false);
            positionMs = Math.max(0L, intent.getLongExtra(EXTRA_POSITION, 0L));
            durationMs = Math.max(0L, intent.getLongExtra(EXTRA_DURATION, 0L));
            refreshSessionAndNotification();
        } else if (ACTION_PLAY.equals(action)) {
            handleControl("play");
        } else if (ACTION_PAUSE.equals(action)) {
            handleControl("pause");
        } else if (ACTION_TOGGLE.equals(action)) {
            handleControl(playing ? "pause" : "play");
        } else if (ACTION_NEXT.equals(action)) {
            publishControl("next", 0L);
        } else if (ACTION_PREVIOUS.equals(action)) {
            publishControl("previous", 0L);
        }
        return START_NOT_STICKY;
    }

    private void handleControl(String control) {
        if ("play".equals(control)) {
            if (!hasTrack) {
                publishControl(control, positionMs);
                return;
            }
            playing = true;
            updateWakeLock();
            refreshSessionAndNotification();
        } else if ("pause".equals(control)) {
            playing = false;
            updateWakeLock();
            if (hasTrack) refreshSessionAndNotification();
        } else if ("seekTo".equals(control)) {
            refreshSessionAndNotification();
        }
        publishControl(control, positionMs);
    }

    private void publishControl(String control, long position) {
        Intent event = new Intent(ACTION_MEDIA_CONTROL);
        event.setPackage(getPackageName());
        event.putExtra(EXTRA_CONTROL, control);
        event.putExtra(EXTRA_POSITION, Math.max(0L, position));
        sendBroadcast(event);
    }

    private void refreshSessionAndNotification() {
        if (!hasTrack || mediaSession == null) return;

        playingTrack = playing;
        updateWakeLock();
        String displayTitle = title.isEmpty() ? "Pulsar" : title;
        MediaMetadata metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, displayTitle)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
            .build();
        mediaSession.setMetadata(metadata);

        int state = playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        float speed = playing ? 1.0f : 0.0f;
        PlaybackState playbackState = new PlaybackState.Builder()
            .setActions(SESSION_ACTIONS)
            .setState(state, positionMs, speed, SystemClock.elapsedRealtime())
            .build();
        mediaSession.setPlaybackState(playbackState);
        mediaSession.setActive(true);

        Notification notification = buildNotification(displayTitle);
        if (playing) {
            boolean promoted = false;
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                promoted = true;
            } catch (RuntimeException ignored) {
                // Some Android versions refuse a media playback foreground
                // service (for example when notifications are blocked). Fall
                // back to a plain notification so the media session, the wake
                // lock and WebView playback keep working.
                promoted = false;
            }
            foreground = promoted;
            if (!promoted) notificationManager.notify(NOTIFICATION_ID, notification);
        } else {
            notificationManager.notify(NOTIFICATION_ID, notification);
            if (foreground) {
                stopForeground(STOP_FOREGROUND_DETACH);
                foreground = false;
            }
        }
    }

    private Notification buildNotification(String displayTitle) {
        PendingIntent previous = servicePendingIntent(ACTION_PREVIOUS, 1);
        PendingIntent playPause = servicePendingIntent(playing ? ACTION_PAUSE : ACTION_PLAY, 2);
        PendingIntent next = servicePendingIntent(ACTION_NEXT, 3);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(displayTitle)
            .setContentText(artist.isEmpty() ? "Pulsar" : artist)
            .setSubText("Pulsar")
            .setContentIntent(createLaunchPendingIntent())
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", previous).build())
            .addAction(new Notification.Action.Builder(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "Pause" : "Play",
                playPause
            ).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", next).build());
        return builder.build();
    }

    private PendingIntent servicePendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, PulsarPlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(this, requestCode, intent, pendingIntentFlags());
    }

    private PendingIntent createLaunchPendingIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, intent, pendingIntentFlags());
    }

    private int pendingIntentFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || notificationManager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Pulsar playback", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Playback controls and currently playing track");
        channel.setShowBadge(false);
        notificationManager.createNotificationChannel(channel);
    }

    private void updateWakeLock() {
        if (playbackWakeLock == null) return;
        if (playing && !playbackWakeLock.isHeld()) {
            playbackWakeLock.acquire();
        } else if (!playing && playbackWakeLock.isHeld()) {
            playbackWakeLock.release();
        }
    }

    private void clearPlaybackAndStop() {
        hasTrack = false;
        playing = false;
        playingTrack = false;
        updateWakeLock();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.setPlaybackState(new PlaybackState.Builder()
                .setState(PlaybackState.STATE_NONE, 0L, 0.0f)
                .build());
        }
        if (foreground) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            foreground = false;
        } else if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
        stopSelf();
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        playing = false;
        playingTrack = false;
        updateWakeLock();
        if (playbackWakeLock != null && playbackWakeLock.isHeld()) playbackWakeLock.release();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        if (notificationManager != null) notificationManager.cancel(NOTIFICATION_ID);
        super.onDestroy();
    }
}
