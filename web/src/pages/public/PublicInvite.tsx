/**
 * PublicInvite Page
 *
 * Public page for accepting invitations via code.
 * Route: /invite/:code
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Loader2, CheckCircle, XCircle, Calendar, Users, ArrowRight } from 'lucide-react'
import { validateInvitationCode, redeemInvitationCode, type ValidationResult } from '../../data/invitations'

export function PublicInvite() {
    const { code } = useParams<{ code: string }>()
    const navigate = useNavigate()

    const [validation, setValidation] = useState<ValidationResult | null>(null)
    const [loading, setLoading] = useState(true)
    const [redeeming, setRedeeming] = useState(false)
    const [redeemed, setRedeemed] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        async function validate() {
            if (!code) {
                setError('Geen code opgegeven')
                setLoading(false)
                return
            }

            const { data, error: fetchError } = await validateInvitationCode(code)

            if (fetchError) {
                setError('Er ging iets mis bij het valideren van de code')
            } else if (data && !data.valid) {
                setError(
                    data.error === 'CODE_NOT_FOUND' ? 'Deze code bestaat niet of is niet meer actief' :
                    data.error === 'CODE_EXPIRED' ? 'Deze code is verlopen' :
                    data.error === 'CODE_EXHAUSTED' ? 'Deze code is al het maximale aantal keer gebruikt' :
                    'Ongeldige code'
                )
            } else if (data) {
                setValidation(data)
            }

            setLoading(false)
        }

        validate()
    }, [code])

    const handleAccept = async () => {
        if (!code) return

        setRedeeming(true)
        const { data, error: redeemError } = await redeemInvitationCode(code)

        if (redeemError || !data?.success) {
            setError(
                data?.error === 'ALREADY_REDEEMED' ? 'Je hebt deze uitnodiging al geaccepteerd' :
                'Er ging iets mis bij het accepteren'
            )
            setRedeeming(false)
            return
        }

        setRedeemed(true)

        // Redirect after short delay
        setTimeout(() => {
            if (data.redirect) {
                navigate(data.redirect)
            } else {
                navigate('/events')
            }
        }, 2000)
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="h-12 w-12 animate-spin text-indigo-600 mx-auto" />
                    <p className="mt-4 text-gray-600">Code valideren...</p>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
                <div className="max-w-md w-full text-center">
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
                        <XCircle className="h-16 w-16 text-red-500 mx-auto" />
                        <h1 className="mt-4 text-xl font-semibold text-gray-900">Ongeldige uitnodiging</h1>
                        <p className="mt-2 text-gray-600">{error}</p>
                        <Link
                            to="/events"
                            className="mt-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                        >
                            Bekijk evenementen
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    if (redeemed) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
                <div className="max-w-md w-full text-center">
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
                        <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
                        <h1 className="mt-4 text-xl font-semibold text-gray-900">Uitnodiging geaccepteerd!</h1>
                        <p className="mt-2 text-gray-600">Je wordt doorgestuurd...</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="max-w-md w-full">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    {/* Header */}
                    <div className="bg-indigo-600 px-6 py-8 text-center">
                        <h1 className="text-2xl font-bold text-white">Je bent uitgenodigd!</h1>
                        {validation?.label && (
                            <p className="mt-1 text-indigo-200">{validation.label}</p>
                        )}
                    </div>

                    {/* Content */}
                    <div className="p-6">
                        {/* Org Info */}
                        <div className="flex items-center p-4 bg-gray-50 rounded-lg">
                            <div className="flex-shrink-0 w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                                <Users className="h-6 w-6 text-indigo-600" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm text-gray-500">Organisatie</p>
                                <p className="font-medium text-gray-900">{validation?.org?.name}</p>
                            </div>
                        </div>

                        {/* Event Info (if applicable) */}
                        {validation?.event && (
                            <div className="mt-4 flex items-center p-4 bg-gray-50 rounded-lg">
                                <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                                    <Calendar className="h-6 w-6 text-green-600" />
                                </div>
                                <div className="ml-4">
                                    <p className="text-sm text-gray-500">Evenement</p>
                                    <p className="font-medium text-gray-900">{validation.event.name}</p>
                                </div>
                            </div>
                        )}

                        {/* Code Display */}
                        <div className="mt-6 text-center">
                            <p className="text-sm text-gray-500">Activatiecode</p>
                            <p className="text-2xl font-mono font-bold text-gray-900">{validation?.code}</p>
                            {validation?.uses_remaining !== null && validation?.uses_remaining !== undefined && (
                                <p className="mt-1 text-sm text-gray-400">
                                    Nog {validation.uses_remaining} keer te gebruiken
                                </p>
                            )}
                        </div>

                        {/* Accept Button */}
                        <button
                            onClick={handleAccept}
                            disabled={redeeming}
                            className="mt-6 w-full flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {redeeming ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <>
                                    Accepteer uitnodiging
                                    <ArrowRight className="ml-2 h-5 w-5" />
                                </>
                            )}
                        </button>

                        <p className="mt-4 text-center text-xs text-gray-400">
                            Door te accepteren ga je akkoord met de voorwaarden.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
