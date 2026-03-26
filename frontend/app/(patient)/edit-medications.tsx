import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import Screen from '../../src/components/Screen';
import Header from '../../src/components/Header';
import Card from '../../src/components/Card';
import Input from '../../src/components/Input';
import Button from '../../src/components/Button';
import EmptyState from '../../src/components/EmptyState';
import LoadingState from '../../src/components/LoadingState';
import { colors, fonts, spacing, radius } from '../../src/theme';
import { patientDataService, Medication as APIMedication } from '../../src/services/patientData';
import { scanMedicalSheet } from '../../src/services/orito';


interface LocalMedication {
  id?: string;
  name: string;
  dosage: string;
  frequency: string;
  schedule_times: string[];
  notes?: string;
  is_active?: boolean;
}

type FrequencyType = 'once' | 'twice' | 'three' | 'as_needed' | 'custom';

const FREQUENCY_OPTIONS: { key: FrequencyType; label: string; times: string[] }[] = [
  { key: 'once', label: 'Once Daily', times: ['08:00'] },
  { key: 'twice', label: 'Twice Daily', times: ['08:00', '20:00'] },
  { key: 'three', label: 'Three Times', times: ['08:00', '14:00', '20:00'] },
  { key: 'as_needed', label: 'As Needed', times: [] },
  { key: 'custom', label: 'Custom', times: [] },
];


//------This Function handles the Time Picker Modal---------
function TimePickerModal({
  visible,
  onClose,
  onConfirm
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (time: string) => void;
}) {
  const [selectedHour, setSelectedHour] = useState(8);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [isAM, setIsAM] = useState(true);

  //------This Function handles the Hours---------
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = [0, 15, 30, 45];

  //------This Function handles the Handle Confirm---------
  const handleConfirm = () => {
    const hour24 = isAM ? (selectedHour === 12 ? 0 : selectedHour) : (selectedHour === 12 ? 12 : selectedHour + 12);
    const timeStr = `${hour24.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
    onConfirm(timeStr);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.modalOverlay} onPress={onClose}>
        <Pressable style={s.timePickerModal} onPress={e => e.stopPropagation()}>
          <Text style={s.timePickerTitle}>Select Time</Text>

          <View style={s.timePickerRow}>
            {}
            <View style={s.timePickerColumn}>
              <Text style={s.timePickerLabel}>Hour</Text>
              <ScrollView style={s.timePickerScroll} showsVerticalScrollIndicator={false}>
                {hours.map(h => (
                  <TouchableOpacity
                    key={h}
                    style={[s.timePickerOption, selectedHour === h && s.timePickerOptionSelected]}
                    onPress={() => setSelectedHour(h)}
                  >
                    <Text style={[s.timePickerOptionText, selectedHour === h && s.timePickerOptionTextSelected]}>
                      {h}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {}
            <View style={s.timePickerColumn}>
              <Text style={s.timePickerLabel}>Minute</Text>
              <ScrollView style={s.timePickerScroll} showsVerticalScrollIndicator={false}>
                {minutes.map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[s.timePickerOption, selectedMinute === m && s.timePickerOptionSelected]}
                    onPress={() => setSelectedMinute(m)}
                  >
                    <Text style={[s.timePickerOptionText, selectedMinute === m && s.timePickerOptionTextSelected]}>
                      {m.toString().padStart(2, '0')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {}
            <View style={s.timePickerColumn}>
              <Text style={s.timePickerLabel}>Period</Text>
              <TouchableOpacity
                style={[s.ampmOption, isAM && s.ampmOptionSelected]}
                onPress={() => setIsAM(true)}
              >
                <Text style={[s.ampmText, isAM && s.ampmTextSelected]}>AM</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.ampmOption, !isAM && s.ampmOptionSelected]}
                onPress={() => setIsAM(false)}
              >
                <Text style={[s.ampmText, !isAM && s.ampmTextSelected]}>PM</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.timePickerButtons}>
            <TouchableOpacity style={s.timePickerCancelBtn} onPress={onClose}>
              <Ionicons name="close-outline" size={16} color={colors.textSecondary} />
              <Text style={s.timePickerCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.timePickerConfirmBtn} onPress={handleConfirm}>
              <Ionicons name="checkmark-outline" size={16} color={colors.bg} />
              <Text style={s.timePickerConfirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


//------This Function handles the Format Time12 Hour---------
function formatTime12Hour(time: string): string {
  if (!time) return time;

  
  if (time.includes('AM') || time.includes('PM')) return time;

  const parts = time.split(':');
  if (parts.length !== 2) return time;

  let hour = parseInt(parts[0], 10);
  const minute = parts[1];
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;

  return `${hour}:${minute} ${ampm}`;
}

//------This Function handles the Edit Medications Screen---------
export default function EditMedicationsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [medications, setMedications] = useState<LocalMedication[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState<FrequencyType | null>(null);
  const [scheduleTimes, setScheduleTimes] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<{ name?: string; dosage?: string }>({});

  useEffect(() => {
    loadData();
  }, []);

  //------This Function handles the Load Data---------
  const loadData = async () => {
    try {
      setLoading(true);
      const data = await patientDataService.loadProfile();
      if (data?.medications) {
        setMedications(data.medications as LocalMedication[]);
      }
    } catch (error) {
      console.error('[EditMedications] Failed to load:', error);
      Alert.alert('Error', 'Failed to load medications');
    } finally {
      setLoading(false);
    }
  };

  //------This Function handles the Handle Add New---------
  const handleAddNew = () => {
    resetForm();
    setShowAddForm(true);
  };

  //------This Function handles the Handle Edit---------
  const handleEdit = (med: LocalMedication) => {
    setEditingId(med.id ?? null);
    setName(med.name);
    setDosage(med.dosage);

    
    const times = med.schedule_times || [];
    let matchedFreq: FrequencyType | null = null;

    for (const opt of FREQUENCY_OPTIONS) {
      if (opt.key !== 'custom' && opt.times.length === times.length) {
        //------This Function handles the Normalized Opt Times---------
        const normalizedOptTimes = opt.times;
        //------This Function handles the Normalized Med Times---------
        const normalizedMedTimes = times;
        if (normalizedOptTimes.every((t: string) => normalizedMedTimes.includes(t))) {
          matchedFreq = opt.key;
          break;
        }
      }
    }

    setFrequency(matchedFreq || 'custom');
    setScheduleTimes(times);
    setNotes(med.notes || '');
    setShowAddForm(true);
  };

  //------This Function handles the Handle Frequency Select---------
  const handleFrequencySelect = (freq: FrequencyType) => {
    setFrequency(freq);
    //------This Function handles the Freq Option---------
    const freqOption = FREQUENCY_OPTIONS.find(f => f.key === freq);
    if (freqOption && freq !== 'custom') {
      setScheduleTimes(freqOption.times);
    }
  };

  //------This Function handles the Handle Add Time---------
  const handleAddTime = (time: string) => {
    if (!scheduleTimes.includes(time)) {
      setScheduleTimes([...scheduleTimes, time]);
    }
  };

  //------This Function handles the Handle Remove Time---------
  const handleRemoveTime = (index: number) => {
    setScheduleTimes(scheduleTimes.filter((_, i) => i !== index));
  };

  //------This Function handles the Validate Form---------
  const validateForm = (): boolean => {
    const newErrors: { name?: string; dosage?: string } = {};

    if (!name.trim()) {
      newErrors.name = 'Medication name is required';
    }
    if (!dosage.trim()) {
      newErrors.dosage = 'Dosage is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  //------This Function handles the Handle Save---------
  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      const medData: APIMedication = {
        id: editingId ?? undefined,
        name: name.trim(),
        dosage: dosage.trim(),
        frequency: frequency ? FREQUENCY_OPTIONS.find(f => f.key === frequency)?.label || '' : '',
        schedule_times: scheduleTimes,
      };

      await patientDataService.saveMedication(medData);
      await loadData();
      resetForm();
      setShowAddForm(false);
      Alert.alert('Success', editingId ? 'Medication updated' : 'Medication added');
    } catch (error) {
      console.error('[EditMedications] Failed to save:', error);
      Alert.alert('Error', 'Failed to save medication');
    }
  };

  //------This Function handles the Handle Delete---------
  const handleDelete = (med: LocalMedication) => {
    Alert.alert(
      'Delete Medication',
      `Are you sure you want to delete ${med.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (med.id !== undefined) {
                await patientDataService.deleteMedication(med.id);
              }
              await loadData();
              Alert.alert('Success', 'Medication deleted');
            } catch (error) {
              console.error('[EditMedications] Failed to delete:', error);
              Alert.alert('Error', 'Failed to delete medication');
            }
          }
        }
      ]
    );
  };

  //------This Function handles the Reset Form---------
  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDosage('');
    setFrequency(null);
    setScheduleTimes([]);
    setNotes('');
    setErrors({});
  };

  //------This Function handles the Handle Cancel---------
  const handleCancel = () => {
    resetForm();
    setShowAddForm(false);
  };

  //------This Function handles the Handle Scan Medical Sheet---------
  const handleScanMedicalSheet = async () => {
    Alert.alert(
      'Scan Medical Sheet',
      'Choose an option',
      [
        {
          text: 'Take Photo',
          onPress: () => captureAndScan(),
        },
        {
          text: 'Choose from Gallery',
          onPress: () => pickAndScan(),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  };

  //------This Function handles the Capture And Scan---------
  const captureAndScan = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Camera access is needed to scan medical sheets');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await processImage(result.assets[0].uri);
    }
  };

  //------This Function handles the Pick And Scan---------
  const pickAndScan = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Photo library access is needed to scan medical sheets');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await processImage(result.assets[0].uri);
    }
  };

  //------This Function handles the Process Image---------
  const processImage = async (uri: string) => {
    setScanning(true);
    try {
      
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });

      
      const result = await scanMedicalSheet(base64);

      if (result) {
        
        if (result.name) setName(result.name);
        if (result.dosage) setDosage(result.dosage);
        if (result.frequency) {
          //------This Function handles the Freq Match---------
          const freqMatch = FREQUENCY_OPTIONS.find(f =>
            f.label.toLowerCase().includes(result.frequency!.toLowerCase()) ||
            result.frequency!.toLowerCase().includes(f.label.toLowerCase().split(' ')[0])
          );
          if (freqMatch) {
            setFrequency(freqMatch.key);
          } else {
            setFrequency('custom');
          }
        }
        if (result.times && result.times.length > 0) {
          setScheduleTimes(result.times);
        }

        setShowAddForm(true);
        Alert.alert('Success', 'Medication information extracted. Please review and save.');
      } else {
        Alert.alert('Could Not Read', 'Unable to extract medication information from the image. Please try again or enter manually.');
      }
    } catch (error) {
      console.error('[EditMedications] Scan error:', error);
      Alert.alert('Error', 'Failed to scan medical sheet');
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <Screen safeArea={false}>
        <Header title="Edit Medications" showBack onBackPress={() => router.back()} centered />
        <LoadingState message="Loading medications..." />
      </Screen>
    );
  }

  return (
    <Screen safeArea={false}>
      <Header
        title="Edit Medications"
        showBack
        onBackPress={() => router.back()}
        centered
      />

      <ScrollView style={s.content} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>


        {}
        {showAddForm && (
          <Card style={s.formCard}>
            <View style={s.formHeader}>
              <Text style={s.formTitle}>
                {editingId ? 'EDIT MEDICATION' : 'ADD MEDICATION'}
              </Text>
              {!editingId && (
                <TouchableOpacity
                  style={s.scanIconButton}
                  onPress={handleScanMedicalSheet}
                  disabled={scanning}
                >
                  {scanning ? (
                    <ActivityIndicator color={colors.textSecondary} size="small" />
                  ) : (
                    <Ionicons name="camera-outline" size={22} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>
              )}
            </View>

            {}
            {!editingId && (
              <TouchableOpacity
                style={s.scanButtonInline}
                onPress={handleScanMedicalSheet}
                disabled={scanning}
              >
                {scanning ? (
                  <ActivityIndicator color={colors.textSecondary} size="small" />
                ) : (
                  <Ionicons name="scan-outline" size={18} color={colors.textSecondary} />
                )}
                <Text style={s.scanButtonInlineText}>
                  {scanning ? 'Scanning...' : 'Scan Medical Sheet to Auto-fill'}
                </Text>
              </TouchableOpacity>
            )}

            <Input
              label="Medication Name"
              value={name}
              onChangeText={setName}
              placeholder="e.g., Aspirin"
              error={errors.name}
            />

            <Input
              label="Dosage"
              value={dosage}
              onChangeText={setDosage}
              placeholder="e.g., 100mg"
              error={errors.dosage}
            />

            {}
            <View style={s.frequencySection}>
              <Text style={s.frequencyLabel}>Frequency</Text>
              <View style={s.frequencyOptions}>
                {FREQUENCY_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[s.frequencyPill, frequency === opt.key && s.frequencyPillActive]}
                    onPress={() => handleFrequencySelect(opt.key)}
                  >
                    <Text style={[s.frequencyPillText, frequency === opt.key && s.frequencyPillTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {}
            <View style={s.timesSection}>
              <Text style={s.timesLabel}>Schedule Times</Text>

              <View style={s.timesList}>
                {scheduleTimes.map((time, index) => (
                  <View key={index} style={s.timeSlot}>
                    <Text style={s.timeSlotText}>{formatTime12Hour(time)}</Text>
                    <TouchableOpacity
                      style={s.timeSlotRemove}
                      onPress={() => handleRemoveTime(index)}
                    >
                      <Ionicons name="close" size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}

                <TouchableOpacity
                  style={s.addTimeButton}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Ionicons name="add" size={18} color={colors.textSecondary} />
                  <Text style={s.addTimeText}>Add Time</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Input
              label="Notes (Optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes..."
              multiline
              numberOfLines={3}
            />

            {}
            {(name || dosage) && (
              <View style={s.previewSection}>
                <Text style={s.previewLabel}>Preview</Text>
                <View style={s.previewCard}>
                  <View style={s.previewHeader}>
                    <Ionicons name="medical" size={20} color={colors.textPrimary} />
                    <Text style={s.previewName}>{name || 'Medication Name'}</Text>
                  </View>
                  {dosage && <Text style={s.previewDetail}>Dosage: {dosage}</Text>}
                  {frequency && (
                    <Text style={s.previewDetail}>
                      Frequency: {FREQUENCY_OPTIONS.find(f => f.key === frequency)?.label}
                    </Text>
                  )}
                  {scheduleTimes.length > 0 && (
                    <View style={s.previewTimes}>
                      {scheduleTimes.map((t, i) => (
                        <View key={i} style={s.previewTimeBadge}>
                          <Text style={s.previewTimeText}>{formatTime12Hour(t)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}

            <View style={s.formButtons}>
              <Button
                variant="secondary"
                title="Cancel"
                icon="close-outline"
                onPress={handleCancel}
                style={s.formButton}
              />
              <Button
                variant="primary"
                title={editingId ? 'Update' : 'Add'}
                icon="save-outline"
                onPress={handleSave}
                style={s.formButton}
              />
            </View>
          </Card>
        )}

        {}
        {medications.length > 0 ? (
          <View style={s.list}>
            {medications.map((med) => (
              <Card key={med.id ?? Math.random()}>
                <View style={s.medCard}>
                  <View style={s.medHeader}>
                    <View style={s.medInfo}>
                      <Ionicons name="medical" size={20} color={colors.textPrimary} />
                      <Text style={s.medName}>{med.name}</Text>
                    </View>

                    <View style={s.medActions}>
                      <TouchableOpacity
                        style={s.actionButton}
                        onPress={() => handleEdit(med)}
                      >
                        <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={s.actionButton}
                        onPress={() => handleDelete(med)}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.danger} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {med.dosage && (
                    <Text style={s.medDetail}>Dosage: {med.dosage}</Text>
                  )}

                  {med.frequency && (
                    <Text style={s.medDetail}>Frequency: {med.frequency}</Text>
                  )}

                  {med.schedule_times && med.schedule_times.length > 0 && (
                    <View style={s.timesContainer}>
                      <Text style={s.medDetail}>Times:</Text>
                      <View style={s.timesListDisplay}>
                        {med.schedule_times.map((time: string, idx: number) => (
                          <View key={idx} style={s.timeBadge}>
                            <Text style={s.timeText}>{formatTime12Hour(time)}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {med.notes && (
                    <Text style={s.medNotes}>{med.notes}</Text>
                  )}
                </View>
              </Card>
            ))}
          </View>
        ) : !showAddForm ? (
          <EmptyState
            icon="medical-outline"
            title="No Medications"
            subtitle="Add your first medication"
          />
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      <TimePickerModal
        visible={showTimePicker}
        onClose={() => setShowTimePicker(false)}
        onConfirm={handleAddTime}
      />

      {}
      {!showAddForm && (
        <TouchableOpacity
          style={s.fab}
          onPress={handleAddNew}
          activeOpacity={0.8}
        >
          <Ionicons name="pencil" size={24} color={colors.bg} />
        </TouchableOpacity>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  fab: {
    position: 'absolute',
    bottom: 90, 
    right: spacing.lg,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 100,
  },
  addButton: {
    marginBottom: spacing.md,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  scanButtonText: {
    color: colors.textPrimary,
    fontSize: fonts.sizes.md,
    fontWeight: '500',
  },
  scanButtonInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  scanButtonInlineText: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.sm,
  },
  formCard: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  formTitle: {
    fontSize: fonts.sizes.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  scanIconButton: {
    padding: spacing.xs,
  },
  frequencySection: {
    gap: spacing.sm,
  },
  frequencyLabel: {
    fontSize: fonts.sizes.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  frequencyOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  frequencyPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  frequencyPillActive: {
    backgroundColor: colors.white,
    borderColor: colors.white,
  },
  frequencyPillText: {
    fontSize: fonts.sizes.sm,
    color: colors.textSecondary,
  },
  frequencyPillTextActive: {
    color: colors.bg,
    fontWeight: '600',
  },
  timesSection: {
    gap: spacing.sm,
  },
  timesLabel: {
    fontSize: fonts.sizes.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  timesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  timeSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  timeSlotText: {
    fontSize: fonts.sizes.sm,
    color: colors.textPrimary,
  },
  timeSlotRemove: {
    padding: 2,
  },
  addTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderStyle: 'dashed',
    gap: spacing.xs,
  },
  addTimeText: {
    fontSize: fonts.sizes.sm,
    color: colors.textSecondary,
  },
  previewSection: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  previewLabel: {
    fontSize: fonts.sizes.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  previewCard: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  previewName: {
    fontSize: fonts.sizes.md,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  previewDetail: {
    fontSize: fonts.sizes.sm,
    color: colors.textSecondary,
  },
  previewTimes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  previewTimeBadge: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  previewTimeText: {
    fontSize: fonts.sizes.xs,
    color: colors.textPrimary,
  },
  formButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  formButton: {
    flex: 1,
  },
  list: {
    gap: spacing.md,
  },
  medCard: {
    gap: spacing.sm,
  },
  medHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  medInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  medName: {
    fontSize: fonts.sizes.md,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  medActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    padding: spacing.xs,
  },
  medDetail: {
    fontSize: fonts.sizes.sm,
    color: colors.textSecondary,
  },
  medNotes: {
    fontSize: fonts.sizes.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  timesContainer: {
    gap: spacing.xs,
  },
  timesListDisplay: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  timeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeText: {
    fontSize: fonts.sizes.xs,
    color: colors.textPrimary,
  },
  
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timePickerModal: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    width: '85%',
    maxWidth: 320,
  },
  timePickerTitle: {
    fontSize: fonts.sizes.lg,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  timePickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.lg,
  },
  timePickerColumn: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  timePickerLabel: {
    fontSize: fonts.sizes.sm,
    color: colors.textSecondary,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  timePickerScroll: {
    height: 120,
    width: 70,
  },
  timePickerOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  timePickerOptionSelected: {
    backgroundColor: colors.white,
  },
  timePickerOptionText: {
    fontSize: fonts.sizes.md,
    color: colors.textSecondary,
  },
  timePickerOptionTextSelected: {
    color: colors.bg,
    fontWeight: '600',
  },
  ampmOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginVertical: 2,
    alignItems: 'center',
    width: 60,
  },
  ampmOptionSelected: {
    backgroundColor: colors.white,
  },
  ampmText: {
    fontSize: fonts.sizes.md,
    color: colors.textSecondary,
  },
  ampmTextSelected: {
    color: colors.bg,
    fontWeight: '600',
  },
  timePickerButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  timePickerCancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  timePickerCancelText: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.md,
    fontWeight: '500',
  },
  timePickerConfirmBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  timePickerConfirmText: {
    color: colors.bg,
    fontSize: fonts.sizes.md,
    fontWeight: '600',
  },
});
