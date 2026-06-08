/**
 * OCR Search Module
 * Provides full-text search across OCR'd documents
 */

import { 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

class OCRSearchEngine {
  constructor(db) {
    this.db = db;
  }

  async search(userId, searchQuery, options = {}) {
    const { documentType = null, limit: resultLimit = 20, minConfidence = 0 } = options;
    if (!searchQuery?.trim()) return [];

    const normalizedQuery = searchQuery.toLowerCase().trim();
    const keywords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);

    let q = query(
      collection(this.db, 'documentIndex'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(200)
    );

    if (documentType) {
      q = query(q, where('documentType', '==', documentType));
    }

    const snapshot = await getDocs(q);
    const results = [];

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const score = this.calculateRelevance(data, keywords, normalizedQuery);
      
      if (score > 0 && (data.confidence || 0) >= minConfidence) {
        results.push({
          id: docSnap.id,
          ocrId: data.ocrId,
          confidence: data.confidence,
          documentType: data.documentType,
          fields: data.fields || {},
          timestamp: data.timestamp?.toDate?.() || data.timestamp,
          relevanceScore: score,
          preview: this.generatePreview(data.searchableText, keywords),
          highlights: this.generateHighlights(data.searchableText, keywords)
        });
      }
    });

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, resultLimit);
  }

  calculateRelevance(data, keywords, fullQuery) {
    const text = (data.searchableText || '').toLowerCase();
    if (!text) return 0;

    let score = 0;
    if (text.includes(fullQuery)) score += 100;

    keywords.forEach(keyword => {
      const matches = (text.match(new RegExp(keyword, 'g')) || []).length;
      score += matches * 10;
    });

    const fields = data.fields || {};
    Object.values(fields).forEach(value => {
      if (value && typeof value === 'string') {
        const fieldLower = value.toLowerCase();
        if (fieldLower.includes(fullQuery)) score += 50;
        keywords.forEach(kw => { if (fieldLower.includes(kw)) score += 20; });
      }
    });

    return score;
  }

  generatePreview(text, keywords) {
    if (!text) return '';
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let bestSentence = sentences[0];
    let bestScore = 0;

    sentences.forEach(sentence => {
      let score = 0;
      keywords.forEach(keyword => {
        if (sentence.toLowerCase().includes(keyword)) score++;
      });
      if (score > bestScore) { bestScore = score; bestSentence = sentence; }
    });

    const preview = bestSentence.trim();
    return preview.length > 200 ? preview.substring(0, 200) + '...' : preview;
  }

  generateHighlights(text, keywords) {
    if (!text) return [];
    const highlights = [];
    
    keywords.forEach(keyword => {
      const regex = new RegExp(`(.{0,30})(${keyword})(.{0,30})`, 'gi');
      const matches = text.matchAll(regex);
      
      for (const match of matches) {
        if (highlights.length >= 3) break;
        highlights.push({ before: match[1].trim(), match: match[2], after: match[3].trim() });
      }
    });

    return highlights;
  }

  async addToIndex(userId, ocrId, ocrData) {
    const indexData = {
      userId,
      ocrId,
      searchableText: this.createSearchableText(ocrData),
      documentType: ocrData.documentType || 'unknown',
      confidence: ocrData.confidence || 0,
      fields: {
        fullName: ocrData.fields?.fullName || ocrData.fields?.applicantName || ocrData.fields?.ownerName || null,
        idNumber: ocrData.fields?.idNumber || ocrData.fields?.permitNumber || ocrData.fields?.titleNumber || null,
        address: ocrData.fields?.address || ocrData.fields?.businessAddress || null
      },
      timestamp: Timestamp.now()
    };

    await setDoc(doc(this.db, 'documentIndex', ocrId), indexData);
  }

  createSearchableText(ocrData) {
    const parts = [];
    if (ocrData.text) parts.push(ocrData.text);
    if (ocrData.fields) {
      Object.values(ocrData.fields).forEach(value => {
        if (value && typeof value === 'string') parts.push(value);
      });
    }
    return parts.join(' ').toLowerCase();
  }

  async removeFromIndex(ocrId) {
    await deleteDoc(doc(this.db, 'documentIndex', ocrId));
  }

  async getRecent(userId, options = {}) {
    const { limit: resultLimit = 10, documentType = null } = options;
    
    let q = query(
      collection(this.db, 'documentIndex'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(resultLimit)
    );

    if (documentType) {
      q = query(q, where('documentType', '==', documentType));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp
    }));
  }
}

export { OCRSearchEngine };
export default OCRSearchEngine;
