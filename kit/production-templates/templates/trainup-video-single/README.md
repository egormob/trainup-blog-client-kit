# Исходный простой шаблон ИИ-Директора

trainup-video-single1.0.0, frozen tag→422d8fb28d1d04a32f0a1335ed4fcc84a931ed03, sourceba896b13eb7ab51991a7cab1743874fd7b8f79ba. Геометрия, CSS и player/gallery/notice сохранены. Тексты — ограниченный исторический пример, не новые обещания клиента; фото/отзывы — подписанные места для собственных материалов, личные реквизиты удалены. Видео не задано и не загружается.

`python3 scripts/create_video_page.py --settings ABS_JSON --output ABS_NEW_DIRECTORY` заполняет свой videoUrl/poster/CTA. Собственный poster должен быть PNG/JPEG/WebP. Генератор требует собственный Kinescope URL, не подставляет авторский. `--check ABS_DIRECTORY` проверяет результат. Provider SDK загружается только при намерении смотреть; реальный playback нового ролика проверяется отдельно.
