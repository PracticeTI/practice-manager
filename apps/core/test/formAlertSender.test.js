import assert from 'node:assert/strict'
import test from 'node:test'
import {
    FORM_ALERT_EMAIL_DOMAIN,
    resolveFormAlertReplyTo,
    resolveFormAlertSender,
    resolveFormAlertSenderEmail,
    resolveFormAlertSenderName,
} from '../src/lib/formAlertSender.js'

test('derives the contact mailbox from the domain key', () => {
    assert.equal(resolveFormAlertSenderEmail('example-domain'), `exampledomain.contact@${FORM_ALERT_EMAIL_DOMAIN}`)
})

test('prefers the configured display name', () => {
    assert.equal(resolveFormAlertSenderName('example-domain', 'Example Therapy'), 'Example Therapy Contact Form')
    assert.equal(
        resolveFormAlertSender('example-domain', 'Example Therapy'),
        `Example Therapy Contact Form <exampledomain.contact@${FORM_ALERT_EMAIL_DOMAIN}>`,
    )
})

test('keeps the mailbox derived from the domain key, not the display name', () => {
    // A customized display name must not move the provisioned mailbox.
    assert.equal(
        resolveFormAlertSender('example-domain', 'Example Therapy Clinic'),
        `Example Therapy Clinic Contact Form <exampledomain.contact@${FORM_ALERT_EMAIL_DOMAIN}>`,
    )
})

test('returns an empty sender when no domain is available', () => {
    assert.equal(resolveFormAlertSenderEmail(''), '')
    assert.equal(resolveFormAlertSenderName('', 'Any Domain'), '')
    assert.equal(resolveFormAlertSender(''), '')
})

test('routes replies back to the submitter', () => {
    assert.equal(
        resolveFormAlertReplyTo('Jo Bloggs', 'jo@example.com'),
        'Jo Bloggs <jo@example.com>',
    )
    // Falls back to the bare address when no name was supplied.
    assert.equal(resolveFormAlertReplyTo('', 'jo@example.com'), 'jo@example.com')
})

test('strips newlines from the submitter name so headers stay single-line', () => {
    assert.equal(
        resolveFormAlertReplyTo('Jo\r\nBcc: evil@example.com', 'jo@example.com'),
        'JoBcc: evil@example.com <jo@example.com>',
    )
})

test('returns an empty reply-to when the submitter email is missing', () => {
    assert.equal(resolveFormAlertReplyTo('Jo Bloggs', ''), '')
    assert.equal(resolveFormAlertSender(''), '')
})
