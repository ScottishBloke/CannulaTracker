import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const DURATION_MS = 72 * 60 * 60 * 1000;
const STORAGE_KEY_TS = "cannula_inserted_at";
const STORAGE_KEY_SITE = "cannula_insertion_site";

const INSERTION_SITES = [
  "Inner Right Stomach",
  "Inner Left Stomach",
  "Outer Right Stomach",
  "Outer Left Stomach",
] as const;

type InsertionSite = (typeof INSERTION_SITES)[number];

function getRemainingMs(insertedAt: number): number {
  return DURATION_MS - (Date.now() - insertedAt);
}

function formatCountdown(ms: number): {
  days: number;
  hours: string;
  minutes: string;
  seconds: string;
} {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return {
    days,
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
  };
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Status = "none" | "active" | "warning" | "critical" | "overdue";

function getStatus(insertedAt: number | null, remaining: number): Status {
  if (insertedAt === null) return "none";
  if (remaining <= 0) return "overdue";
  if (remaining <= 2 * 60 * 60 * 1000) return "critical";
  if (remaining <= 12 * 60 * 60 * 1000) return "warning";
  return "active";
}

const STATUS_META: Record<Status, { label: string; color: string }> = {
  none: { label: "NO ACTIVE CANNULA", color: "#7d8590" },
  active: { label: "ACTIVE", color: "#00d4aa" },
  warning: { label: "EXPIRING SOON", color: "#f59e0b" },
  critical: { label: "CHANGE SOON", color: "#ef4444" },
  overdue: { label: "OVERDUE — CHANGE NOW", color: "#ef4444" },
};

export default function CannulaTracker() {
  const insets = useSafeAreaInsets();
  const [insertedAt, setInsertedAt] = useState<number | null>(null);
  const [insertionSite, setInsertionSite] = useState<InsertionSite | null>(null);
  const [remaining, setRemaining] = useState<number>(DURATION_MS);
  const [loaded, setLoaded] = useState(false);
  const [siteModalVisible, setSiteModalVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_TS),
      AsyncStorage.getItem(STORAGE_KEY_SITE),
    ]).then(([tsVal, siteVal]) => {
      if (tsVal) {
        const ts = parseInt(tsVal, 10);
        if (!isNaN(ts)) {
          setInsertedAt(ts);
          setRemaining(getRemainingMs(ts));
        }
      }
      if (siteVal && (INSERTION_SITES as readonly string[]).includes(siteVal)) {
        setInsertionSite(siteVal as InsertionSite);
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded || insertedAt === null) return;
    const tick = () => setRemaining(getRemainingMs(insertedAt));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loaded, insertedAt]);

  const doInsert = useCallback(async (site: InsertionSite) => {
    const now = Date.now();
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_TS, now.toString()),
      AsyncStorage.setItem(STORAGE_KEY_SITE, site),
    ]);
    setInsertedAt(now);
    setInsertionSite(site);
    setRemaining(DURATION_MS);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleInsert = useCallback(() => {
    setSiteModalVisible(true);
  }, []);

  const handleSiteSelected = useCallback(
    (site: InsertionSite) => {
      setSiteModalVisible(false);
      doInsert(site);
    },
    [doInsert]
  );

  const handleFailed = useCallback(() => {
    setSiteModalVisible(true);
  }, []);

  if (!loaded) return null;

  const status = getStatus(insertedAt, remaining);
  const { label: statusLabel, color: statusColor } = STATUS_META[status];
  const { days, hours, minutes, seconds } = formatCountdown(remaining);

  const topPad = Math.max(insets.top, Platform.OS === "web" ? 67 : 0) + 24;
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0) + 24;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />

      <View style={[styles.container, { paddingTop: topPad, paddingBottom: botPad }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appTitle}>CANNULA TRACKER</Text>
          <View style={[styles.badge, { borderColor: statusColor }]}>
            <View style={[styles.badgeDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.badgeText, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
        </View>

        {/* Timer */}
        <View style={styles.timerCard}>
          {insertedAt === null ? (
            <View style={styles.emptyTimer}>
              <Text style={styles.emptyIcon}>⏱</Text>
              <Text style={styles.emptyText}>No cannula inserted</Text>
              <Text style={styles.emptyHint}>
                Tap "Insert New Cannula" to start the 72-hour clock
              </Text>
            </View>
          ) : (
            <>
              {days > 0 && (
                <Text style={styles.daysLabel}>
                  {days} day{days !== 1 ? "s" : ""}
                </Text>
              )}
              <View style={styles.timerRow}>
                <TimeUnit value={hours} label="HRS" color={statusColor} />
                <Text style={[styles.colon, { color: statusColor }]}>:</Text>
                <TimeUnit value={minutes} label="MIN" color={statusColor} />
                <Text style={[styles.colon, { color: statusColor }]}>:</Text>
                <TimeUnit value={seconds} label="SEC" color={statusColor} />
              </View>
              <Text style={styles.remainingLabel}>remaining</Text>
            </>
          )}
        </View>

        {/* Info Card */}
        {insertedAt !== null && (
          <View style={styles.infoCard}>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Insertion Date</Text>
              <Text style={styles.infoValue}>{formatDateTime(insertedAt)}</Text>
            </View>
            <View style={styles.infoSep} />
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Insertion Site</Text>
              <Text style={styles.infoValue}>
                {insertionSite ?? "—"}
              </Text>
            </View>
            <View style={styles.infoSep} />
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Due by</Text>
              <Text style={[styles.infoValue, { color: statusColor }]}>
                {formatDateTime(insertedAt + DURATION_MS)}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.spacer} />

        {/* Buttons */}
        <Pressable
          testID="insert-cannula-btn"
          style={({ pressed }) => [
            styles.primaryBtn,
            { opacity: pressed ? 0.82 : 1 },
          ]}
          onPress={handleInsert}
        >
          <Text style={styles.primaryBtnText}>Insert New Cannula</Text>
        </Pressable>

        {insertedAt !== null && (
          <Pressable
            testID="cannula-failed-btn"
            style={({ pressed }) => [
              styles.dangerBtn,
              { opacity: pressed ? 0.82 : 1 },
            ]}
            onPress={handleFailed}
          >
            <Text style={styles.dangerBtnText}>Cannula Failed</Text>
          </Pressable>
        )}
      </View>

      {/* Site Selection Modal */}
      <Modal
        visible={siteModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSiteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setSiteModalVisible(false)}
          />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Where was the cannula inserted?</Text>
            <Text style={styles.modalSubtitle}>Select the insertion site</Text>
            <View style={styles.siteGrid}>
              {INSERTION_SITES.map((site) => (
                <Pressable
                  key={site}
                  style={({ pressed }) => [
                    styles.siteBtn,
                    { opacity: pressed ? 0.75 : 1 },
                  ]}
                  onPress={() => handleSiteSelected(site)}
                >
                  <Text style={styles.siteBtnText}>{site}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={styles.cancelBtn}
              onPress={() => setSiteModalVisible(false)}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TimeUnit({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}) {
  return (
    <View style={styles.timeUnit}>
      <Text style={[styles.digit, { color }]}>{value}</Text>
      <Text style={styles.unitLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 28,
  },
  appTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    letterSpacing: 4,
    color: "#7d8590",
    marginBottom: 14,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 24,
    borderWidth: 1,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  badgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 1.5,
  },
  timerCard: {
    backgroundColor: "#161b22",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#30363d",
    paddingVertical: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 14,
  },
  emptyTimer: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 4,
  },
  emptyText: {
    fontFamily: "Inter_500Medium",
    fontSize: 17,
    color: "#7d8590",
  },
  emptyHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#484f58",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  daysLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: "#7d8590",
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  timeUnit: {
    alignItems: "center",
    minWidth: 72,
  },
  digit: {
    fontFamily: "Inter_700Bold",
    fontSize: 56,
    lineHeight: 64,
    letterSpacing: -2,
  },
  unitLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#7d8590",
    letterSpacing: 2,
    marginTop: 2,
  },
  colon: {
    fontFamily: "Inter_700Bold",
    fontSize: 48,
    lineHeight: 68,
    marginHorizontal: 2,
  },
  remainingLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#7d8590",
    marginTop: 14,
    letterSpacing: 1,
  },
  infoCard: {
    backgroundColor: "#161b22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30363d",
    paddingHorizontal: 18,
    paddingVertical: 4,
    marginBottom: 8,
  },
  infoBlock: {
    paddingVertical: 13,
    gap: 4,
  },
  infoSep: {
    height: 1,
    backgroundColor: "#30363d",
  },
  infoLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#7d8590",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  infoValue: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: "#e6edf3",
  },
  spacer: {
    flex: 1,
  },
  primaryBtn: {
    backgroundColor: "#00d4aa",
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: "#0d1117",
    letterSpacing: 0.3,
  },
  dangerBtn: {
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#ef4444",
  },
  dangerBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: "#ef4444",
    letterSpacing: 0.3,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalSheet: {
    backgroundColor: "#161b22",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#30363d",
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#30363d",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: "#e6edf3",
    textAlign: "center",
    marginBottom: 6,
  },
  modalSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#7d8590",
    textAlign: "center",
    marginBottom: 24,
  },
  siteGrid: {
    gap: 10,
    marginBottom: 16,
  },
  siteBtn: {
    backgroundColor: "#21262d",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30363d",
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  siteBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: "#e6edf3",
  },
  cancelBtn: {
    paddingVertical: 16,
    alignItems: "center",
  },
  cancelBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: "#7d8590",
  },
});
