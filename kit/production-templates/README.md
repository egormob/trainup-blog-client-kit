# Принятые production-шаблоны

Две зафиксированные производные из Landings: подробная продающая статья «ИИ-директор» и её исходный более простой layout trainup-video-single1.0.0. Это дополнение к basic/advanced/consent, а не замена их движка. Исходные commit/hash и точные изменения — template-provenance.json.

Сохраняются принятые CSS, структура и public commercial text как исторический пример. Даты/цены не являются новым предложением. Фото людей и скриншоты отзывов заменены явно подписанными SVG-местами: перед публикацией нужны собственные разрешённые материалы и подтверждённые факты. Принятая созданная для этого шаблона схема сохранена. Нет авторских кабинетов, контактных реквизитов, video ID, auth или активной оплаты. Пример всегда preview/noindex.

Python3.10+ (stdlib). Из этой папки или с абсолютными путями:

```sh
python3 scripts/premium_article.py check-template
python3 scripts/premium_article.py create --output /absolute/new-page
python3 scripts/premium_article.py build --output /absolute/new-page
python3 scripts/create_video_page.py --help
```

После создания меняйте компоненты экземпляра и settings.json. Frozen источник не редактировать; обновление требует новой версии. Для первоначального простого layout смотрите templates/trainup-video-single/README.md. Его пустой video slot безопасен; воспроизведение своего ролика проверяется отдельно. Установка и сборка не скачивают ничего и не публикуют. Для согласий используйте соседний проверенный kit/consent, для кабинетов/доставки — свой установленный Admin. Шрифт системный; внешние шрифты не включены.

Одна композиция/порядок/схема на всех ширинах, без скрытых мобильных дублей. Проверьте320/390/768/980/1440, FAQ, отзывы/CTA, focus и overflow. Browser engines и физическое устройство отмечайте отдельно. Native checkout и внешний playback не подтверждаются preview.

Последний принятый ИИ-Директор26октября — templates/ai-director-latest-20261026. Создание: `python3 scripts/premium_article.py create --template latest --output ABS_NEW_DIRECTORY`. Он сохраняет обновлённую программу3отделов, callouts и SVG устройств. Premium13октября сохранён отдельно для истории, исходный простой single1.0.0 также отдельно. Черновики29октября не включены.
