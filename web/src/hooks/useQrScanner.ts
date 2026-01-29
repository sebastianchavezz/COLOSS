/**
 * useQrScanner Hook
 *
 * Custom React hook wrapping html5-qrcode library for camera QR scanning.
 * Features:
 * - Camera permission handling
 * - Debounce to prevent rapid re-scans
 * - Camera switching support
 * - Error handling
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode'

export interface UseQrScannerOptions {
    onScan: (token: string) => void
    onError?: (error: string) => void
    debounceMs?: number
}

export interface CameraDevice {
    id: string
    label: string
}

export interface UseQrScannerResult {
    isScanning: boolean
    error: string | null
    cameraId: string | null
    cameras: CameraDevice[]
    start: (cameraId?: string) => Promise<void>
    stop: () => Promise<void>
    switchCamera: (cameraId: string) => Promise<void>
}

export function useQrScanner(
    containerId: string,
    options: UseQrScannerOptions
): UseQrScannerResult {
    const { onScan, onError, debounceMs = 2000 } = options

    const [isScanning, setIsScanning] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [cameraId, setCameraId] = useState<string | null>(null)
    const [cameras, setCameras] = useState<CameraDevice[]>([])

    const scannerRef = useRef<Html5Qrcode | null>(null)
    const lastScanTimeRef = useRef<number>(0)
    const lastScanTokenRef = useRef<string>('')

    // Load available cameras
    useEffect(() => {
        Html5Qrcode.getCameras()
            .then((devices) => {
                const cameraList = devices.map((d) => ({
                    id: d.id,
                    label: d.label || `Camera ${d.id.slice(0, 8)}`,
                }))
                setCameras(cameraList)

                // Prefer back camera on mobile
                const backCamera = cameraList.find(
                    (c) =>
                        c.label.toLowerCase().includes('back') ||
                        c.label.toLowerCase().includes('rear') ||
                        c.label.toLowerCase().includes('achter')
                )
                if (backCamera) {
                    setCameraId(backCamera.id)
                } else if (cameraList.length > 0) {
                    setCameraId(cameraList[0].id)
                }
            })
            .catch((err) => {
                setError('Camera toegang geweigerd')
                onError?.('Camera toegang geweigerd: ' + err.message)
            })
    }, [onError])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                const state = scannerRef.current.getState()
                if (state === Html5QrcodeScannerState.SCANNING) {
                    scannerRef.current.stop().catch(console.error)
                }
            }
        }
    }, [])

    const handleScanSuccess = useCallback(
        (decodedText: string) => {
            const now = Date.now()
            const timeSinceLastScan = now - lastScanTimeRef.current

            // Debounce: ignore if same token scanned within debounce window
            if (
                timeSinceLastScan < debounceMs &&
                decodedText === lastScanTokenRef.current
            ) {
                return
            }

            lastScanTimeRef.current = now
            lastScanTokenRef.current = decodedText
            onScan(decodedText)
        },
        [onScan, debounceMs]
    )

    const start = useCallback(
        async (targetCameraId?: string) => {
            const camId = targetCameraId || cameraId
            if (!camId) {
                setError('Geen camera beschikbaar')
                return
            }

            setError(null)

            try {
                // Create new scanner instance if needed
                if (!scannerRef.current) {
                    scannerRef.current = new Html5Qrcode(containerId)
                }

                // Stop if already scanning
                const state = scannerRef.current.getState()
                if (state === Html5QrcodeScannerState.SCANNING) {
                    await scannerRef.current.stop()
                }

                // Start scanning
                await scannerRef.current.start(
                    camId,
                    {
                        fps: 10,
                        qrbox: { width: 250, height: 250 },
                        aspectRatio: 1.0,
                    },
                    handleScanSuccess,
                    () => {
                        // QR code scan error (no QR found) - ignore
                    }
                )

                setCameraId(camId)
                setIsScanning(true)
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Onbekende fout'
                setError('Camera kon niet worden gestart: ' + message)
                onError?.('Camera start error: ' + message)
                setIsScanning(false)
            }
        },
        [containerId, cameraId, handleScanSuccess, onError]
    )

    const stop = useCallback(async () => {
        if (scannerRef.current) {
            const state = scannerRef.current.getState()
            if (state === Html5QrcodeScannerState.SCANNING) {
                await scannerRef.current.stop()
            }
        }
        setIsScanning(false)
    }, [])

    const switchCamera = useCallback(
        async (newCameraId: string) => {
            if (isScanning) {
                await stop()
            }
            await start(newCameraId)
        },
        [isScanning, stop, start]
    )

    return {
        isScanning,
        error,
        cameraId,
        cameras,
        start,
        stop,
        switchCamera,
    }
}
